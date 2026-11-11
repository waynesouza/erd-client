export interface LinkDataModel {

  id: string;
  from: string;
  to: string;
  text: string | null;
  toText: number;
  // The foreign key column of the `from` table. The export uses it instead of
  // guessing the column from the table names.
  fromColumn?: string;

}
