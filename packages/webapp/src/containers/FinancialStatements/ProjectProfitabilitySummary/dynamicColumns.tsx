import * as R from 'ramda';

import { getColumnWidth } from '@/utils';
import { Align } from '@/constants';

const characterColumn = R.curry((data: any[], index: number, column: Record<string, any>) => ({
  id: column.key,
  key: column.key,
  Header: column.label,
  accessor: `cells[${index}].value`,
  className: column.key,
  width: getColumnWidth(data, `cells.${index}.key`, {
    minWidth: 200,
    magicSpacing: 10,
  }),
  disableSortBy: true,
  textOverview: true,
  sticky: Align.Left,
}));

const numericColumn = R.curry((data: any[], index: number, column: Record<string, any>) => ({
  id: column.key,
  key: column.key,
  Header: column.label,
  accessor: `cells[${index}].value`,
  className: column.key,
  width: getColumnWidth(data, `cells.${index}.key`, {
    minWidth: 130,
    magicSpacing: 10,
  }),
  disableSortBy: true,
  align: Align.Right,
}));

/**
 *  columns mapper.
 */
const columnsMapper = R.curry((data: any[], index: number, column: Record<string, any>) => ({
  id: column.key,
  key: column.key,
  Header: column.label,
  accessor: `cells[${index}].value`,
  className: column.key,
  width: getColumnWidth(data, `cells.${index}.key`, {
    minWidth: 130,
    magicSpacing: 10,
  }),
  disableSortBy: true,
  textOverview: true,
}));

/**
 * project profitability summary columns mapper.
 */
export const dynamicColumns = (columns: Record<string, any>[], data: any[]) => {
  const mapper = (column: Record<string, any>, index: number) => {
    return R.compose(
      R.cond([
        [R.pathEq(['key'], 'name'), characterColumn(data, index)],
        [R.pathEq(['key'], 'customer_name'), characterColumn(data, index)],
        [R.pathEq(['key'], 'income'), numericColumn(data, index)],
        [R.pathEq(['key'], 'expenses'), numericColumn(data, index)],
        [R.pathEq(['key'], 'profit'), numericColumn(data, index)],
        [R.T, columnsMapper(data, index)],
      ]),
    )(column);
  };
  return columns.map(mapper);
};
