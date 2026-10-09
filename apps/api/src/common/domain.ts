import { UnprocessableEntityException } from '@nestjs/common';

/**
 * Exécute une règle métier du cœur (`@bouffe/core`) et traduit ses erreurs
 * (aliment inconnu, aucune alternative possible…) en réponse HTTP 422 lisible.
 */
export function domain<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    throw new UnprocessableEntityException(error instanceof Error ? error.message : 'Opération impossible.');
  }
}
