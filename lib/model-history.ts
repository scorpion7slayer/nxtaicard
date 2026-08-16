interface HistoricalModelIdentity {
  id?: string;
  slug: string;
}

function modelIdentityKeys(model: HistoricalModelIdentity): string[] {
  return [
    ...(model.id ? [`id:${model.id}`] : []),
    `slug:${model.slug}`,
  ];
}

export function mergeModelHistory<T extends HistoricalModelIdentity>(
  freshModels: T[],
  previousModels: T[],
  mergeMatched: (fresh: T, previous: T) => T = (fresh) => fresh,
): { models: T[]; retainedCount: number } {
  const previousByIdentity = new Map<string, T[]>();
  for (const model of previousModels) {
    for (const key of modelIdentityKeys(model)) {
      const matches = previousByIdentity.get(key) ?? [];
      matches.push(model);
      previousByIdentity.set(key, matches);
    }
  }

  const matchedPrevious = new Set<T>();
  const mergedFresh = freshModels.map((fresh) => {
    const matches = new Set(
      modelIdentityKeys(fresh).flatMap(
        (key) => previousByIdentity.get(key) ?? [],
      ),
    );
    if (matches.size === 0) return fresh;
    for (const previous of matches) matchedPrevious.add(previous);
    return [...matches].reduce(
      (merged, previous) => mergeMatched(merged, previous),
      fresh,
    );
  });

  const freshIdentityKeys = new Set(
    freshModels.flatMap((model) => modelIdentityKeys(model)),
  );
  const retainedModels = previousModels.filter(
    (model) =>
      !matchedPrevious.has(model) &&
      modelIdentityKeys(model).every((key) => !freshIdentityKeys.has(key)),
  );

  return {
    models: [...mergedFresh, ...retainedModels],
    retainedCount: retainedModels.length,
  };
}
