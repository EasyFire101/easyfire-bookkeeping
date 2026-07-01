import React from 'react';
import {
  Button,
  Classes,
  NavbarDivider,
  NavbarGroup,
  Intent,
  Alignment,
  Menu,
  MenuItem,
  Popover,
  PopoverInteractionKind,
  Position,
} from '@blueprintjs/core';
import { useHistory } from 'react-router-dom';
import {
  FormattedMessage as T,
  AdvancedFilterPopover,
  Icon,
  Can,
  DashboardActionViewsList,
  DashboardFilterButton,
  DashboardRowsHeightButton,
  DashboardActionsBar,
} from '@/components';
import { withEstimates } from './withEstimates';
import { withEstimatesActions } from './withEstimatesActions';
import { withSettings } from '@/containers/Settings/withSettings';
import { withSettingsActions } from '@/containers/Settings/withSettingsActions';
import { withDialogActions } from '@/containers/Dialog/withDialogActions';
import { useEstimatesListContext } from './EstimatesListProvider';
import { useRefreshEstimates } from '@/hooks/query/estimates';
import { useDownloadExportPdf } from '@/hooks/query/FinancialReports/use-export-pdf';
import { useBulkDeleteEstimatesDialog } from './hooks/use-bulk-delete-estimates-dialog';
import { SaleEstimateAction, AbilitySubject } from '@/constants/abilityOption';
import { compose } from '@/utils';
import { DialogsName } from '@/constants/dialogs';
import { withDrawerActions } from '@/containers/Drawer/withDrawerActions';
import { DRAWERS } from '@/constants/drawers';
import { isEmpty } from 'lodash';
import type { WithDrawerActionsProps } from '@/containers/Drawer/withDrawerActions';
import type { WithEstimatesProps } from './withEstimates';
import type { WithDialogActionsProps } from '@/containers/Dialog/withDialogActions';

interface WithEstimatesActionsProps {
  setEstimatesTableState: (state: Record<string, any>) => void;
}

interface WithSettingsActionsProps {
  addSetting: (group: string, key: string, value: any) => void;
}

interface WithSettingsProps {
  estimatesTableSize?: string | null;
}

interface EstimateActionsBarProps
  extends Pick<WithEstimatesProps, 'estimatesSelectedRows'>,
    WithEstimatesActionsProps,
    WithSettingsActionsProps,
    WithDialogActionsProps,
    WithDrawerActionsProps,
    WithSettingsProps {
  estimatesFilterRoles: any[];
}

function EstimateActionsBar({
  setEstimatesTableState,
  estimatesFilterRoles,
  estimatesSelectedRows = [],
  estimatesTableSize,
  openDialog,
  openDrawer,
  addSetting,
}: EstimateActionsBarProps) {
  const history = useHistory();
  const { estimatesViews, fields } = useEstimatesListContext();
  const { downloadAsync: downloadExportPdf } = useDownloadExportPdf();

  const onClickNewEstimate = () => {
    history.push('/estimates/new');
  };
  const { refresh } = useRefreshEstimates();

  const handleTabChange = (view: { slug?: string } | null) => {
    setEstimatesTableState({
      viewSlug: view ? view.slug : null,
    });
  };
  const handleRefreshBtnClick = () => {
    refresh();
  };
  const handleTableRowSizeChange = (size: any) => {
    addSetting('salesEstimates', 'tableSize', size);
  };
  const handleImportBtnClick = () => {
    history.push('/estimates/import');
  };
  const handleExportBtnClick = () => {
    openDialog(DialogsName.Export, { resource: 'sale_estimate' });
  };
  const handlePrintBtnClick = () => {
    downloadExportPdf({ resource: 'SaleEstimate' });
  };
  const handleCustomizeBtnClick = () => {
    openDrawer(DRAWERS.BRANDING_TEMPLATES, { resource: 'SaleEstimate' });
  };

  const { openBulkDeleteDialog, isValidatingBulkDeleteEstimates } =
    useBulkDeleteEstimatesDialog();

  const handleBulkDelete = () => {
    openBulkDeleteDialog(estimatesSelectedRows as number[]);
  };

  if (!isEmpty(estimatesSelectedRows)) {
    return (
      <DashboardActionsBar>
        <NavbarGroup>
          <Button
            className={Classes.MINIMAL}
            icon={<Icon icon="trash-16" iconSize={16} />}
            text={<T id={'delete'} />}
            intent={Intent.DANGER}
            onClick={handleBulkDelete}
            disabled={isValidatingBulkDeleteEstimates}
          />
        </NavbarGroup>
      </DashboardActionsBar>
    );
  }

  return (
    <DashboardActionsBar>
      <NavbarGroup>
        <DashboardActionViewsList
          resourceName={'estimates'}
          allMenuItem={true}
          allMenuItemText={<T id={'all'} />}
          views={estimatesViews}
          onChange={handleTabChange}
        />
        <NavbarDivider />
        <Can I={SaleEstimateAction.Create} a={AbilitySubject.Estimate}>
          <Button
            className={Classes.MINIMAL}
            icon={<Icon icon={'plus'} />}
            text={<T id={'new_estimate'} />}
            onClick={onClickNewEstimate}
          />
        </Can>
        <AdvancedFilterPopover
          advancedFilterProps={{
            conditions: estimatesFilterRoles,
            defaultFieldKey: 'estimate_number',
            fields: fields,
            onFilterChange: (filterConditions: any) => {
              setEstimatesTableState({ filterRoles: filterConditions });
            },
          }}
        >
          <DashboardFilterButton
            conditionsCount={estimatesFilterRoles.length}
          />
        </AdvancedFilterPopover>
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
          initialValue={estimatesTableSize}
          onChange={handleTableRowSizeChange}
        />
        <NavbarDivider />
      </NavbarGroup>

      <NavbarGroup align={Alignment.RIGHT}>
        <Popover
          minimal={true}
          interactionKind={PopoverInteractionKind.CLICK}
          position={Position.BOTTOM_RIGHT}
          modifiers={{
            offset: { offset: '0, 4' },
          }}
          content={
            <Menu>
              <MenuItem
                onClick={handleCustomizeBtnClick}
                text={'Customize Templates'}
              />
            </Menu>
          }
        >
          <Button icon={<Icon icon="cog-16" iconSize={16} />} minimal={true} />
        </Popover>
        <NavbarDivider />
        <Button
          className={Classes.MINIMAL}
          icon={<Icon icon="refresh-16" iconSize={14} />}
          onClick={handleRefreshBtnClick}
        />
      </NavbarGroup>
    </DashboardActionsBar>
  );
}

export const EstimatesActionsBar = compose(
  withEstimatesActions,
  withSettingsActions,
  withEstimates(({ estimatesTableState, estimatesSelectedRows }) => ({
    estimatesFilterRoles: estimatesTableState.filterRoles,
    estimatesSelectedRows: estimatesSelectedRows || [],
  })),
  withSettings(({ estimatesSettings }: any) => ({
    estimatesTableSize: estimatesSettings?.tableSize,
  })),
  withDialogActions,
  withDrawerActions,
)(EstimateActionsBar);
