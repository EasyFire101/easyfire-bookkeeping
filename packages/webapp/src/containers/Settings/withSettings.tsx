import { MapStateToProps, connect } from 'react-redux';
import type { MapState } from '@/containers/hoc.types';
import type { ApplicationState } from '@/store/reducers';

type SettingsData = ApplicationState['settings']['data'];
type SettingsGroup = Record<string, unknown> | undefined;

export interface WithSettingsProps {
  allSettings: SettingsData;
  organizationSettings: SettingsGroup;
  manualJournalsSettings: SettingsGroup;
  billPaymentSettings: SettingsGroup;
  billsettings: SettingsGroup;
  paymentReceiveSettings: SettingsGroup;
  estimatesSettings: SettingsGroup;
  receiptSettings: SettingsGroup;
  invoiceSettings: SettingsGroup;
  itemsSettings: SettingsGroup;
  expenseSettings: SettingsGroup;
  accountsSettings: SettingsGroup;
  customersSettings: SettingsGroup;
  vendorsSettings: SettingsGroup;
  cashflowSettings: SettingsGroup;
  cashflowTransactionsSettings: SettingsGroup;
  cashflowSetting: SettingsGroup;
  creditNoteSettings: SettingsGroup;
  vendorsCreditNoteSetting: SettingsGroup;
  warehouseTransferSettings: SettingsGroup;
  projectSettings: SettingsGroup;
  projectTasksSettings: SettingsGroup;
  timesheetsSettings: SettingsGroup;
}

export const withSettings = <Props = unknown,>(
  mapState?: MapState<WithSettingsProps, Props>,
) => {
  const mapStateToProps: MapStateToProps<
    WithSettingsProps,
    Props,
    ApplicationState
  > = (state, props) => {
    const data = state.settings.data as Record<string, SettingsGroup>;
    const mapped: WithSettingsProps = {
      allSettings: state.settings.data,
      organizationSettings: data.organization,
      manualJournalsSettings: data.manualJournals,
      billPaymentSettings: data.billPayments,
      billsettings: data.bills,
      paymentReceiveSettings: data.paymentReceives,
      estimatesSettings: data.salesEstimates,
      receiptSettings: data.salesReceipts,
      invoiceSettings: data.salesInvoices,
      itemsSettings: data.items,
      expenseSettings: data.expenses,
      accountsSettings: data.accounts,
      customersSettings: data.customers,
      vendorsSettings: data.vendors,
      cashflowSettings: data.cashflowAccounts,
      cashflowTransactionsSettings: data.cashflowTransactions,
      cashflowSetting: data.cashflow,
      creditNoteSettings: data.creditNote,
      vendorsCreditNoteSetting: data.vendorCredit,
      warehouseTransferSettings: data.warehouseTransfers,
      projectSettings: data.projects,
      projectTasksSettings: data.projectTasks,
      timesheetsSettings: data.timesheets,
    };
    return mapState
      ? (mapState(mapped, state, props) as WithSettingsProps)
      : mapped;
  };

  return connect(mapStateToProps);
};
