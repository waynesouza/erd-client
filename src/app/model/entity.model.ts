import { AttributeModel } from './attribute.model';

/**
 * A position kept as a plain object because it is sent to the backend as is.
 * A go.Point would serialize its internal fields instead, and those are not
 * stable: GoJS 4 writes them as `px`/`py`, which the backend drops.
 */
export interface Location {
  x: number;
  y: number;
}

export interface EntityModel {

  id: string;
  key: string;
  items: AttributeModel[];
  location: Location;

}
