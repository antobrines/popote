// Le cœur métier ne dépend ni du DOM ni de Node : seules ces deux fonctions universelles sont déclarées.
declare function setTimeout(handler: () => void, ms: number): unknown;
declare function clearTimeout(handle: unknown): void;
