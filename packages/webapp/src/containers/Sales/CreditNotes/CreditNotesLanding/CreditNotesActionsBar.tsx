import {
  Button,
  Classes,
  NavbarDivider,
  NavbarGroup,
  Alignment,
  Intent,
  Menu,
  MenuItem,
  Popover,
  PopoverInteractionKind,
  Position,
} from '@blueprintjs/core';
import { isEmpty } from 'lodash';
import React from 'react';
import { useHistory } from 'react-router-dom';
import { useCreditNoteListContext } from './CreditNotesListProvider';
import { useBulkDeleteCreditNotesDialog } from './hooks/use-bulk-delete-credit-notes-dialog';
import { withCreditNotes } from './withCreditNotes';
import { withCreditNotesActions } from './withCreditNotesActions';
import type { WithCreditNotesProps } from './withCreditNotes';
import type { WithDialogActionsProps } from '@/containers/Dialog/withDialogActions';
import type { WithDrawerActionsProps } from '@/containers/Drawer/withDrawerActions';
import {
  Icon,
  Can,
  FormattedMessage as T,
  DashboardActionViewsList,
  AdvancedFilterPopover,
  DashboardFilterButton,
  DashboardRowsHeightButton,
  DashboardActionsBar,
} from '@/components';
import { CreditNoteAction, AbilitySubject } from '@/constants/abilityOption';
import { DialogsName } from '@/constants/dialogs';
import { DRAWERS } from '@/constants/drawers';
import { withDialogActions } from '@/containers/Dialog/withDialogActions';
import { withDrawerActions } from '@/containers/Drawer/withDrawerActions';
import { withSettings } from '@/containers/Settings/withSettings';
import { withSettingsActions } from '@/containers/Settings/withSettingsActions';
import { useDownloadExportPdf } from '@/hooks/query/FinancialReports/use-export-pdf';
import { compose } from '@/utils';

interface WithCreditNotesActionsProps {
  setCreditNotesTableState: (state: Record<string, any>) => void;
}

interface WithSettingsActionsProps {
  addSetting: (group: string, key: string, value: any) => void;
}

interface WithSettingsProps {
  creditNoteTableSize?: string | null;
}

interface CreditNotesActionsBarProps
  extends Pick<WithCreditNotesProps, 'creditNotesSelectedRows'>,
    WithCreditNotesActionsProps,
    WithSettingsActionsProps,
    WithDialogActionsProps,
    WithDrawerActionsProps,
    WithSettingsProps {
  creditNoteFilterRoles: any[];
}

function CreditNotesActionsBarInner({
  creditNoteFilterRoles,
  creditNotesSelectedRows,
  setCreditNotesTableState,
  creditNoteTableSize,
  addSetting,
  openDialog,
  openDrawer,
}: CreditNotesActionsBarProps) {
  const history = useHistory();

  const { CreditNotesView, fields, refresh } = useCreditNoteListContext();

  const { downloadAsync: downloadExportPdf } = useDownloadExportPdf();

  const handleTabChange = (view: { slug?: string } | null) => {
    setCreditNotesTableState({ viewSlug: view ? view.slug : null });
  };

  const handleClickNewCreateNote = () => {
    history.push('/credit-notes/new');
  };

  const handleRefreshBtnClick = () => {
    refresh();
  };
  const handleTableRowSizeChange = (size: any) => {
    addSetting('creditNote', 'tableSize', size);
  };
  const handleImportBtnClick = () => {
    history.push('/credit-notes/import');
  };
  const handleExportBtnClick = () => {
    openDialog(DialogsName.Export, { resource: 'credit_note' });
  };
  const handlePrintBtnClick = () => {
    downloadExportPdf({ resource: 'CreditNote' });
  };
  const handleCustomizeBtnClick = () => {
    openDrawer(DRAWERS.BRANDING_TEMPLATES, { resource: 'CreditNote' });
  };

  const { openBulkDeleteDialog, isValidatingBulkDeleteCreditNotes } =
    useBulkDeleteCreditNotesDialog();

  if (!isEmpty(creditNotesSelectedRows)) {
    const handleBulkDelete = () => {
      openBulkDeleteDialog(creditNotesSelectedRows as number[]);
    };
    return (
      <DashboardActionsBar>
        <NavbarGroup>
          <Button
            className={Classes.MINIMAL}
            icon={<Icon icon="trash-16" iconSize={16} />}
            text={<T id={'delete'} />}
            intent={Intent.DANGER}
            onClick={handleBulkDelete}
            disabled={isValidatingBulkDeleteCreditNotes}
          />
        </NavbarGroup>
      </DashboardActionsBar>
    );
  }

  return (
    <DashboardActionsBar>
      <NavbarGroup>
        <DashboardActionViewsList
          allMenuItem={true}
          resourceName={'credit_notes'}
          views={CreditNotesView}
          onChange={handleTabChange}
        />
        <NavbarDivider />
        <Can I={CreditNoteAction.Create} a={AbilitySubject.CreditNote}>
          <Button
            className={Classes.MINIMAL}
            icon={<Icon icon={'plus'} />}
            text={<T id={'credit_note.label.new_credit_note'} />}
            onClick={handleClickNewCreateNote}
          />
        </Can>
        <AdvancedFilterPopover
          advancedFilterProps={{
            conditions: creditNoteFilterRoles,
            defaultFieldKey: 'created_at',
            fields: fields,
            onFilterChange: (filterConditions: any) => {
              setCreditNotesTableState({ filterRoles: filterConditions });
            },
          }}
        >
          <DashboardFilterButton
            conditionsCount={creditNoteFilterRoles.length}
          />
        </AdvancedFilterPopover>

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
          initialValue={creditNoteTableSize}
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

export const CreditNotesActionsBar = compose(
  withCreditNotesActions,
  withSettingsActions,
  withCreditNotes(({ creditNoteTableState, creditNotesSelectedRows }) => ({
    creditNoteFilterRoles: creditNoteTableState.filterRoles,
    creditNotesSelectedRows,
  })),
  withSettings(({ creditNoteSettings }: any) => ({
    creditNoteTableSize: creditNoteSettings?.tableSize,
  })),
  withDialogActions,
  withDrawerActions,
)(CreditNotesActionsBarInner);
