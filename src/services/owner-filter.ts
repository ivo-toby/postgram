export function normalizeOwner(
  owner: string | null | undefined
): string | null {
  if (owner === undefined || owner === null) {
    return null;
  }

  const trimmed = owner.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function matchesOwnerFilter(
  entityOwner: string | null,
  ownerFilter: string | undefined
): boolean {
  if (ownerFilter === undefined) {
    return true;
  }

  return entityOwner === ownerFilter || entityOwner === null || entityOwner === 'shared';
}

export function ownerSqlCondition(
  column: string,
  placeholder: string
): string {
  return `(${placeholder}::text IS NULL OR ${column} = ${placeholder} OR ${column} IS NULL OR ${column} = 'shared')`;
}
