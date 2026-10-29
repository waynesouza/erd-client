import { EntityModel } from '../model/entity.model';
import { LinkDataModel } from '../model/link-data.model';

/** A diagram detached from GoJS: plain copies that GoJS never mutates. */
export interface DiagramState {
  entities: EntityModel[];
  relationships: LinkDataModel[];
}

/**
 * What one client changed since the last state the server sent it. It is the
 * body of /app/patch (plus the projectId): the backend applies it element by
 * element, so changes made by other collaborators to other tables survive.
 */
export interface DiagramPatch {
  upsertNodes: EntityModel[];
  removedNodeIds: string[];
  upsertLinks: LinkDataModel[];
  removedLinkIds: string[];
}

interface Identified {
  id: string;
}

// GoJS tags every data object with bookkeeping keys such as __gohashid.
const isGoJsKey = (key: string): boolean => key.startsWith('__');

/**
 * Deep copy of the diagram without GoJS keys. Positions become numbers: the
 * backend stores them as strings, and a "10" against a 10 would otherwise look
 * like a move.
 */
export function snapshotDiagram(entities: EntityModel[], relationships: LinkDataModel[]): DiagramState {
  const copy = <T>(value: T): T =>
    JSON.parse(JSON.stringify(value, (key, field) => (isGoJsKey(key) ? undefined : field)));

  return {
    entities: copy(entities).map((entity: EntityModel) => ({
      ...entity,
      location: { x: Number(entity.location?.x ?? 0), y: Number(entity.location?.y ?? 0) }
    })),
    relationships: copy(relationships)
  };
}

// Key order and null fields differ between what the backend returns and what
// the editor builds, so neither may count as a change.
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, field) => {
    if (field === null) {
      return undefined;
    }
    if (typeof field === 'object' && !Array.isArray(field)) {
      return Object.keys(field).sort().reduce((sorted: Record<string, unknown>, key) => {
        sorted[key] = field[key];
        return sorted;
      }, {});
    }
    return field;
  });
}

// Elements without an id (links saved before links had one) cannot be addressed
// by a patch, so they are left out of it.
function changedElements<T extends Identified>(base: T[], local: T[]): T[] {
  const before = new Map(base.filter(element => element.id).map(element => [element.id, canonical(element)]));
  return local.filter(element => element.id && before.get(element.id) !== canonical(element));
}

function removedIds<T extends Identified>(base: T[], local: T[]): string[] {
  const kept = new Set(local.map(element => element.id));
  return base.filter(element => element.id && !kept.has(element.id)).map(element => element.id);
}

export function diffDiagram(base: DiagramState, local: DiagramState): DiagramPatch {
  return {
    upsertNodes: changedElements(base.entities, local.entities),
    removedNodeIds: removedIds(base.entities, local.entities),
    upsertLinks: changedElements(base.relationships, local.relationships),
    removedLinkIds: removedIds(base.relationships, local.relationships)
  };
}

export function isEmptyPatch(patch: DiagramPatch): boolean {
  return patch.upsertNodes.length === 0 && patch.removedNodeIds.length === 0
    && patch.upsertLinks.length === 0 && patch.removedLinkIds.length === 0;
}

function mergeById<T extends Identified>(current: T[], upserts: T[], removed: string[]): T[] {
  const removedSet = new Set(removed);
  const upsertsById = new Map(upserts.map(element => [element.id, element]));
  const known = new Set(current.map(element => element.id));

  return current
    .filter(element => !removedSet.has(element.id))
    .map(element => upsertsById.get(element.id) ?? element)
    .concat(upserts.filter(element => !known.has(element.id) && !removedSet.has(element.id)));
}

/** Same merge rule as the backend, used to replay pending local changes on a newer server state. */
export function applyDiagramPatch(state: DiagramState, patch: DiagramPatch): DiagramState {
  return {
    entities: mergeById(state.entities, patch.upsertNodes, patch.removedNodeIds),
    relationships: mergeById(state.relationships, patch.upsertLinks, patch.removedLinkIds)
  };
}
