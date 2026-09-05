const PERSON_UID_FIELDS = ['actorUid', 'targetUid', 'memberUid'];
const DELETED_UID = 'deleted-user';

function cleanUid(value) {
  const uid = typeof value === 'string' ? value.trim() : '';
  return uid && uid !== DELETED_UID ? uid : '';
}

export function deriveActivityIdentityUids(activity = {}) {
  return [...new Set(PERSON_UID_FIELDS.map((field) => cleanUid(activity?.[field])).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

export { PERSON_UID_FIELDS };
