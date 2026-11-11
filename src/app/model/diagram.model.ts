import { EntityModel } from './entity.model';

export interface DiagramModel {

  nodeDataArray: EntityModel[];
  linkDataArray: {
    from: string;
    to: string;
    text: string;
    toText: string;
  }[];
  // Incremented by the server each time the whole diagram is replaced (an import).
  // Absent when the server predates revisions.
  revision?: number;

}
