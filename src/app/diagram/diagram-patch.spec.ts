import { EntityModel } from '../model/entity.model';
import { LinkDataModel } from '../model/link-data.model';
import {
  applyDiagramPatch,
  DiagramState,
  diffDiagram,
  isEmptyPatch,
  snapshotDiagram
} from './diagram-patch';

describe('diagram-patch', () => {
  const entity = (id: string, key: string, x = 0): EntityModel =>
    ({ id, key, items: [], location: { x, y: 0 } });
  const link = (id: string, from: string, to: string): LinkDataModel =>
    ({ id, from, to, text: null, toText: 1 });
  const state = (entities: EntityModel[], relationships: LinkDataModel[] = []): DiagramState =>
    ({ entities, relationships });

  describe('snapshotDiagram', () => {
    it('should copy the diagram without the GoJS bookkeeping keys', () => {
      const tracked = { ...entity('e1', 'users'), __gohashid: 42 } as EntityModel;

      const snapshot = snapshotDiagram([tracked], [link('l1', 'e1', 'e1')]);

      expect(snapshot.entities[0]).toEqual(entity('e1', 'users'));
      expect(snapshot.entities[0]).not.toBe(tracked);
      expect(snapshot.relationships).toEqual([link('l1', 'e1', 'e1')]);
    });

    it('should turn the positions the backend sends as strings into numbers', () => {
      const fromServer = { ...entity('e1', 'users'), location: { x: '10', y: '20' } } as unknown as EntityModel;

      expect(snapshotDiagram([fromServer], []).entities[0].location).toEqual({ x: 10, y: 20 });
    });

    it('should place a table without a position at the origin', () => {
      const unplaced = { id: 'e1', key: 'users', items: [] } as unknown as EntityModel;

      expect(snapshotDiagram([unplaced], []).entities[0].location).toEqual({ x: 0, y: 0 });
    });
  });

  describe('diffDiagram', () => {
    it('should report the added, changed and removed tables and links', () => {
      const base = state([entity('e1', 'users'), entity('e2', 'orders')], [link('l1', 'e2', 'e1')]);
      const local = state([entity('e1', 'customers'), entity('e3', 'products')], [link('l2', 'e3', 'e1')]);

      expect(diffDiagram(base, local)).toEqual({
        upsertNodes: [entity('e1', 'customers'), entity('e3', 'products')],
        removedNodeIds: ['e2'],
        upsertLinks: [link('l2', 'e3', 'e1')],
        removedLinkIds: ['l1']
      });
    });

    it('should not count key order or null fields as a change', () => {
      const fromServer = { location: { y: 0, x: 0 }, items: [], key: 'users', id: 'e1', firstEntityId: null };
      const local = entity('e1', 'users');

      const patch = diffDiagram(state([fromServer as unknown as EntityModel]), state([local]));

      expect(isEmptyPatch(patch)).toBeTrue();
    });

    it('should count a move as a change', () => {
      expect(diffDiagram(state([entity('e1', 'users', 0)]), state([entity('e1', 'users', 50)])).upsertNodes)
        .toEqual([entity('e1', 'users', 50)]);
    });

    it('should leave elements without an id out of the patch', () => {
      const legacy = { ...link('', 'e2', 'e1'), id: undefined } as unknown as LinkDataModel;

      const patch = diffDiagram(state([], [legacy]), state([], []));
      const added = diffDiagram(state([], []), state([], [legacy]));

      expect(patch.removedLinkIds).toEqual([]);
      expect(added.upsertLinks).toEqual([]);
    });
  });

  describe('isEmptyPatch', () => {
    const none = { upsertNodes: [], removedNodeIds: [], upsertLinks: [], removedLinkIds: [] };

    it('should be true only when nothing changed', () => {
      expect(isEmptyPatch(none)).toBeTrue();
      expect(isEmptyPatch({ ...none, upsertNodes: [entity('e1', 'users')] })).toBeFalse();
      expect(isEmptyPatch({ ...none, removedNodeIds: ['e1'] })).toBeFalse();
      expect(isEmptyPatch({ ...none, upsertLinks: [link('l1', 'e1', 'e1')] })).toBeFalse();
      expect(isEmptyPatch({ ...none, removedLinkIds: ['l1'] })).toBeFalse();
    });
  });

  describe('applyDiagramPatch', () => {
    it('should replay local changes on top of a newer server state', () => {
      // The server already has another user's rename of e2; this client renamed e1.
      const server = state([entity('e1', 'users'), entity('e2', 'orders_renamed_by_b')]);
      const pending = diffDiagram(
        state([entity('e1', 'users'), entity('e2', 'orders')]),
        state([entity('e1', 'customers'), entity('e2', 'orders')])
      );

      expect(applyDiagramPatch(server, pending).entities)
        .toEqual([entity('e1', 'customers'), entity('e2', 'orders_renamed_by_b')]);
    });

    it('should append new elements and drop removed ones', () => {
      const server = state([entity('e1', 'users')], [link('l1', 'e1', 'e1')]);
      const patch = {
        upsertNodes: [entity('e2', 'orders')],
        removedNodeIds: ['e1'],
        upsertLinks: [link('l2', 'e2', 'e2')],
        removedLinkIds: ['l1']
      };

      expect(applyDiagramPatch(server, patch)).toEqual(state([entity('e2', 'orders')], [link('l2', 'e2', 'e2')]));
    });

    it('should not resurrect an element that is both upserted and removed', () => {
      const patch = { upsertNodes: [entity('e9', 'ghost')], removedNodeIds: ['e9'], upsertLinks: [], removedLinkIds: [] };

      expect(applyDiagramPatch(state([]), patch).entities).toEqual([]);
    });
  });
});
