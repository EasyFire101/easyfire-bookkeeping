import React from 'react';
import {
  Button,
  Classes,
  NavbarDivider,
  NavbarGroup,
  Intent,
  Alignment,
} from '@blueprintjs/core';

import { useHistory } from 'react-router-dom';

import {
  If,
  Can,
  Icon,
  FormattedMessage as T,
  DashboardActionViewsList,
  DashboardFilterButton,
  AdvancedFilterPopover,
  DashboardRowsHeightButton,
  DashboardActionsBar,
} from '@/components';
import { BillAction, AbilitySubject } from '@/constants/abilityOption';

import { withBills } from './withBills';
import type { WithBillsProps } from './withBills';
import { withBillsActions } from './withBillsActions';
import { withSettings } from '@/containers/Settings/withSettings';
import { withSettingsActions } from '@/containers/Settings/withSettingsActions';
import { withDialogActions } from '@/containers/Dialog/withDialogActions';
import type { WithDialogActionsProps } from '@/containers/Dialog/withDialogActions';

import { useBillsListContext } from './BillsListProvider';
import { useRefreshBills } from '@/hooks/query/bills';
import { useDownloadExportPdf } from '@/hooks/query/FinancialReports/use-export-pdf';
import { useBulkDeleteBillsDialog } from './hooks/use-bulk-delete-bills-dialog';

import { compose } from '@/utils';
import { DialogsName } from '@/constants/dialogs';
import { isEmpty } from 'lodash';

interface WithBillsActionsProps {
  setBillsTableState: (state: Record<string, any>) => void;
}

interface WithSettingsActionsProps {
  addSetting: (group: string, key: string, value: any) => void;
}

interface WithSettingsProps {
  billsTableSize?: string | null;
}

interface BillActionsBarProps
  extends Pick<WithBillsProps, 'billsSelectedRows'>,
    WithBillsActionsProps,
    WithSettingsActionsProps,
    WithDialogActionsProps,
    WithSettingsProps {
  billsConditionsRoles: any[];
}

function BillActionsBar({
  setBillsTableState,
  billsConditionsRoles,
  billsSelectedRows,
  billsTableSize,
  addSetting,
  openDialog,
}: BillActionsBarProps) {
  const history = useHistory();

  const { refresh } = useRefreshBills();

  const { billsViews, fields } = useBillsListContext();

  const { downloadAsync: downloadExportPdf } = useDownloadExportPdf();

  const handleClickNewBill = () => {
    history.push('/bills/new');
  };
  const handleTabChange = (view: { slug?: string } | null) => {
    setBillsTableState({
      viewSlug: view ? view.slug : null,
    });
  };
  const handleRefreshBtnClick = () => {
    refresh();
  };
  const handleTableRowSizeChange = (size: any) => {
    addSetting('bills', 'tableSize', size);
  };
  const handleImportBtnClick = () => {
    history.push('/bills/import');
  };
  const handleExportBtnClick = () => {
    openDialog(DialogsName.Export, { resource: 'bill' });
  };
  const handlePrintBtnClick = () => {
    downloadExportPdf({ resource: 'Bill' });
  };
  const { openBulkDeleteDialog, isValidatingBulkDeleteBills } =
    useBulkDeleteBillsDialog();

  const handleBulkDelete = () => {
    openBulkDeleteDialog(billsSelectedRows as number[]);
  };

  if (!isEmpty(billsSelectedRows)) {
    return (
      <DashboardActionsBar>
        <NavbarGroup>
          <Button
            className={Classes.MINIMAL}
            icon={<Icon icon="trash-16" iconSize={16} />}
            text={<T id={'delete'} />}
            intent={Intent.DANGER}
            onClick={handleBulkDelete}
            disabled={isValidatingBulkDeleteBills}
          />
        </NavbarGroup>
      </DashboardActionsBar>
    );
  }

  return (
    <DashboardActionsBar>
      <NavbarGroup>
        <DashboardActionViewsList
          resourceName={'bills'}
          views={billsViews}
          allMenuItem={true}
          allMenuItemText={<T id={'all'} />}
          onChange={handleTabChange}
        />
        <NavbarDivider />
        <Can I={BillAction.Create} a={AbilitySubject.Bill}>
          <Button
            className={Classes.MINIMAL}
            icon={<Icon icon={'plus'} />}
            text={<T id={'new_bill'} />}
            onClick={handleClickNewBill}
          />
        </Can>
        <AdvancedFilterPopover
          advancedFilterProps={{
            conditions: billsConditionsRoles,
            defaultFieldKey: 'bill_number',
            fields: fields,
            onFilterChange: (filterConditions: any) => {
              setBillsTableState({ filterRoles: filterConditions });
            },
          }}
        >
          <DashboardFilterButton
            conditionsCount={billsConditionsRoles.length}
          />
        </AdvancedFilterPopover>

        <If condition={false}>
          <Button
            className={Classes.MINIMAL}
            icon={<Icon icon={'trash-16'} iconSize={16} />}
            text={<T id={'delete'} />}
            intent={Intent.DANGER}
          />
        </If>
        <NavbarDivider />
        <Button
          className={Classes.MINIMAL}
          icon={<Icon icon={'print-16'} iconSize={16} />}
          text={<T id={'print'} />}
          onClick={handlePrintBtnClick}
        />
        <Button
          className={Classes.MINIMAL}
          icon={<Icon icon={'file-import-16'} />}
          text={<T id={'import'} />}
          onClick={handleImportBtnClick}
        />
        <Button
          className={Classes.MINIMAL}
          icon={<Icon icon={'file-export-16'} iconSize={16} />}
          text={<T id={'export'} />}
          onClick={handleExportBtnClick}
        />
        <NavbarDivider />
        <DashboardRowsHeightButton
          initialValue={billsTableSize}
          onChange={handleTableRowSizeChange}
        />
        <NavbarDivider />
      </NavbarGroup>
      <NavbarGroup align={Alignment.RIGHT}>
        <Button
          className={Classes.MINIMAL}
          icon={<Icon icon="refresh-16" iconSize={14} />}
          onClick={handleRefreshBtnClick}
        />
      </NavbarGroup>
    </DashboardActionsBar>
  );
}

export const BillsActionsBar = compose(
  withBillsActions,
  withSettingsActions,
  withBills(({ billsTableState, billsSelectedRows }) => ({
    billsConditionsRoles: billsTableState.filterRoles,
    billsSelectedRows,
  })),
  withSettings(({ billsettings }: any) => ({
    billsTableSize: billsettings?.tableSize,
  })),
  withDialogActions,
)(BillActionsBar);
