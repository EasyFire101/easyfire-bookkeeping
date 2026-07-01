import {
  NavbarGroup,
  NavbarDivider,
  Button,
  Classes,
  Intent,
} from '@blueprintjs/core';
import {
  If,
  Icon,
  FormattedMessage as T,
  AdvancedFilterPopover,
  DashboardFilterButton,
  DashboardActionsBar,
} from '@/components';

import { withItemCategories } from './withItemCategories';
import type { WithItemCategoriesProps } from './withItemCategories';
import { withItemCategoriesActions } from './withItemCategoriesActions';
import type { WithItemCategoriesActionsProps } from './withItemCategoriesActions';
import { withDialogActions } from '@/containers/Dialog/withDialogActions';
import type { WithDialogActionsProps } from '@/containers/Dialog/withDialogActions';
import { withAlertActions } from '@/containers/Alert/withAlertActions';
import type { WithAlertActionsProps } from '@/containers/Alert/withAlertActions';

import { compose } from '@/utils';
import { useItemsCategoriesContext } from './ItemsCategoriesProvider';
import { useHistory } from 'react-router-dom';
import { DialogsName } from '@/constants/dialogs';

interface ItemsCategoryActionsBarInnerProps
  extends WithItemCategoriesActionsProps,
    WithDialogActionsProps,
    WithAlertActionsProps {
  // NOTE: `itemCategoriesSelectedRows` was destructured from the mapper in the
  // @ts-nocheck original even though `WithItemCategoriesProps` doesn't define
  // it — preserved latent bug; the value is `undefined` at runtime, which means
  // the bulk-delete button never renders.
  itemCategoriesSelectedRows: unknown[];
  categoriesFilterConditions: unknown[];
}

/**
 * Items categories actions bar.
 */
function ItemsCategoryActionsBarInner({
  // #withItemCategories
  itemCategoriesSelectedRows = [],

  categoriesFilterConditions,

  //
  setItemsCategoriesTableState,

  // #withDialog
  openDialog,

  // #withAlertActions
  openAlert,
}: ItemsCategoryActionsBarInnerProps) {
  const { fields } = useItemsCategoriesContext();
  const history = useHistory();

  const onClickNewCategory = () => {
    openDialog('item-category-form', {});
  };

  const handleImportBtnClick = () => {
    history.push('/item/categories/import');
  };

  // Handle the items categories bulk delete.
  const handelBulkDelete = () => {
    openAlert('item-categories-bulk-delete', {
      itemCategoriesIds: itemCategoriesSelectedRows,
    });
  };
  // Handle the export button click.
  const handleExportBtnClick = () => {
    openDialog(DialogsName.Export, { resource: 'item_category' });
  };

  return (
    <DashboardActionsBar>
      <NavbarGroup>
        <Button
          className={Classes.MINIMAL}
          icon={<Icon icon="plus" />}
          text={<T id={'new_category'} />}
          onClick={onClickNewCategory}
        />
        <NavbarDivider />

        <AdvancedFilterPopover
          advancedFilterProps={{
            conditions: categoriesFilterConditions,
            defaultFieldKey: 'name',
            fields: fields,
            onFilterChange: (filterConditions: unknown[]) => {
              setItemsCategoriesTableState({ filterRoles: filterConditions });
            },
          }}
        >
          <DashboardFilterButton
            conditionsCount={categoriesFilterConditions.length}
          />
        </AdvancedFilterPopover>

        <If condition={!!itemCategoriesSelectedRows?.length}>
          <Button
            className={Classes.MINIMAL}
            icon={<Icon icon="trash-16" iconSize={16} />}
            text={<T id={'delete'} />}
            intent={Intent.DANGER}
            onClick={handelBulkDelete}
          />
        </If>

        <Button
          className={Classes.MINIMAL}
          icon={<Icon icon="file-import-16" iconSize={16} />}
          text={<T id={'import'} />}
          onClick={handleImportBtnClick}
        />
        <Button
          className={Classes.MINIMAL}
          icon={<Icon icon="file-export-16" iconSize={16} />}
          text={<T id={'export'} />}
          onClick={handleExportBtnClick}
        />
      </NavbarGroup>
    </DashboardActionsBar>
  );
}

export const ItemsCategoryActionsBar = compose(
  withDialogActions,
  withItemCategories(
    // `itemCategoriesSelectedRows` is not on `WithItemCategoriesProps` — the
    // @ts-nocheck original destructured it anyway, so the value is `undefined`.
    // Preserved latent bug.
    ({ itemsCategoriesTableState }) => ({
      itemCategoriesSelectedRows: undefined,
      categoriesFilterConditions: itemsCategoriesTableState.filterRoles,
    }),
  ),
  withAlertActions,
  withItemCategoriesActions,
)(ItemsCategoryActionsBarInner);
