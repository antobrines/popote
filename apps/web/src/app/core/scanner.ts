/**
 * Lecture de codes-barres EAN/UPC par la caméra.
 *
 * `BarcodeScanner` est une abstraction : le navigateur fournit soit l'API native
 * Barcode Detection (Chrome / Android), soit le repli JavaScript ZXing (Safari, Firefox).
 * Un wrapper Capacitor pourra fournir une troisième implémentation (scanner natif)
 * sans toucher aux écrans : il suffit de la renvoyer depuis `createBarcodeScanner`.
 */
import { ChangeDetectionStrategy, Component, type ElementRef, type OnDestroy, type OnInit, output, signal, viewChild } from '@angular/core';
import { isValidEan } from '@bouffe/core';
import { Icon } from '../ui/ui';

export interface BarcodeScanner {
  readonly kind: 'native' | 'zxing' | 'capacitor';
  start(video: HTMLVideoElement, stream: MediaStream, onCode: (code: string) => void): Promise<void>;
  stop(): void;
}

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

interface DetectorLike {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}

class NativeScanner implements BarcodeScanner {
  readonly kind = 'native' as const;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly detector: DetectorLike) {}

  async start(video: HTMLVideoElement, _stream: MediaStream, onCode: (code: string) => void): Promise<void> {
    let running = false;
    this.timer = setInterval(async () => {
      if (running || video.readyState < 2) return;
      running = true;
      try {
        const found = await this.detector.detect(video);
        if (found[0]?.rawValue) onCode(found[0].rawValue);
      } catch {
        /* image non exploitable : on réessaie à la prochaine itération */
      } finally {
        running = false;
      }
    }, 160);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

class ZxingScanner implements BarcodeScanner {
  readonly kind = 'zxing' as const;
  private controls: { stop(): void } | null = null;

  async start(video: HTMLVideoElement, stream: MediaStream, onCode: (code: string) => void): Promise<void> {
    // Chargé à la demande : ZXing ne pèse pas dans le bundle initial.
    const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
    const hints = new Map<unknown, unknown>([
      [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]],
    ]);
    const reader = new BrowserMultiFormatReader(hints as never, { delayBetweenScanAttempts: 150 });
    this.controls = await reader.decodeFromStream(stream, video, (result) => {
      if (result) onCode(result.getText());
    });
  }

  stop(): void {
    this.controls?.stop();
    this.controls = null;
  }
}

export async function createBarcodeScanner(): Promise<BarcodeScanner> {
  const Detector = (globalThis as { BarcodeDetector?: { new (options: { formats: string[] }): DetectorLike; getSupportedFormats?(): Promise<string[]> } }).BarcodeDetector;
  if (Detector) {
    try {
      const supported = (await Detector.getSupportedFormats?.()) ?? FORMATS;
      const formats = FORMATS.filter((f) => supported.includes(f));
      if (formats.length > 0) return new NativeScanner(new Detector({ formats }));
    } catch {
      /* API présente mais inutilisable : repli ZXing */
    }
  }
  return new ZxingScanner();
}

/** Retour haptique et sonore discret après un scan réussi, si la plateforme le permet. */
export function scanFeedback(): void {
  try {
    navigator.vibrate?.(60);
  } catch {
    /* non pris en charge (iOS) */
  }
}

@Component({
  selector: 'app-scanner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    <div class="fixed inset-0 z-[60] flex flex-col bg-black text-white">
      <div class="relative flex-1 overflow-hidden">
        <video #video class="size-full object-cover" playsinline muted autoplay></video>
        <div class="pointer-events-none absolute inset-0 grid place-items-center">
          <div class="h-40 w-72 max-w-[80%] rounded-3xl border-2 transition-colors duration-200" [class]="flash() ? 'border-[#30d158] bg-[#30d158]/20' : 'border-white/80'"></div>
        </div>
        <div class="absolute inset-x-0 top-0 flex items-center justify-between p-4" style="padding-top: calc(env(safe-area-inset-top) + 1rem)">
          <button type="button" class="grid size-11 place-items-center rounded-full bg-black/50 backdrop-blur" (click)="closed.emit()" aria-label="Fermer le scanner">
            <app-icon name="x" />
          </button>
          @if (torchAvailable()) {
            <button type="button" class="grid size-11 place-items-center rounded-full backdrop-blur" [class]="torch() ? 'bg-white text-black' : 'bg-black/50'" (click)="toggleTorch()" aria-label="Lampe">
              <app-icon name="bolt" />
            </button>
          }
        </div>
        @if (error()) {
          <div class="absolute inset-x-6 top-1/3 rounded-2xl bg-black/70 p-4 text-center text-sm backdrop-blur">{{ error() }}</div>
        }
      </div>
      <form class="flex gap-2 bg-black p-4" style="padding-bottom: calc(env(safe-area-inset-bottom) + 1rem)" (submit)="submitManual($event, manual.value); manual.value = ''">
        <input
          #manual
          class="min-h-12 flex-1 rounded-2xl bg-white/10 px-4 text-base text-white placeholder:text-white/50"
          inputmode="numeric"
          pattern="[0-9]*"
          placeholder="Ou saisir le code-barres"
          aria-label="Code-barres"
        />
        <button type="submit" class="min-h-12 rounded-2xl bg-white px-5 font-semibold text-black">OK</button>
      </form>
      <p class="sr-only" aria-live="polite">{{ status() }}</p>
    </div>
  `,
})
export class ScannerComponent implements OnInit, OnDestroy {
  /** Code-barres lu (ou saisi). */
  readonly code = output<string>();
  readonly closed = output<void>();

  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  protected readonly error = signal('');
  protected readonly status = signal('Caméra en cours de démarrage');
  protected readonly flash = signal(false);
  protected readonly torch = signal(false);
  protected readonly torchAvailable = signal(false);

  private scanner: BarcodeScanner | null = null;
  private stream: MediaStream | null = null;
  private last = { code: '', at: 0 };

  async ngOnInit(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.error.set("La caméra n'est pas accessible ici (connexion non sécurisée ou navigateur trop ancien). Saisis le code ci-dessous.");
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      const video = this.video().nativeElement;
      video.srcObject = this.stream;
      await video.play().catch(() => undefined);
      const track = this.stream.getVideoTracks()[0];
      this.torchAvailable.set(!!(track?.getCapabilities?.() as { torch?: boolean } | undefined)?.torch);
      this.scanner = await createBarcodeScanner();
      await this.scanner.start(video, this.stream, (value) => this.onDetected(value));
      this.status.set('Vise le code-barres');
    } catch (cause) {
      const denied = cause instanceof DOMException && (cause.name === 'NotAllowedError' || cause.name === 'SecurityError');
      this.error.set(
        denied ? "Accès à la caméra refusé. Autorise-la dans les réglages du navigateur, ou saisis le code ci-dessous." : "Impossible de démarrer la caméra. Saisis le code ci-dessous.",
      );
    }
  }

  private onDetected(value: string): void {
    const code = value.trim();
    const now = Date.now();
    // Un même code reste visible plusieurs images : on ne l'émet qu'une fois toutes les 2,5 s.
    if (!isValidEan(code) || (code === this.last.code && now - this.last.at < 2500)) return;
    this.last = { code, at: now };
    scanFeedback();
    this.flash.set(true);
    setTimeout(() => this.flash.set(false), 350);
    this.status.set(`Code ${code} lu`);
    this.code.emit(code);
  }

  protected submitManual(event: Event, value: string): void {
    event.preventDefault();
    const code = value.replace(/\D/g, '');
    if (!isValidEan(code)) {
      this.error.set('Ce code-barres ne semble pas valide (8, 12 ou 13 chiffres).');
      return;
    }
    this.error.set('');
    this.code.emit(code);
  }

  protected async toggleTorch(): Promise<void> {
    const track = this.stream?.getVideoTracks()[0];
    if (!track) return;
    const next = !this.torch();
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      this.torch.set(next);
    } catch {
      this.torchAvailable.set(false);
    }
  }

  ngOnDestroy(): void {
    this.scanner?.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
  }
}
