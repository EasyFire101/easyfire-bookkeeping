// @ts-nocheck
import { BankRulesAlerts } from '../Banking/Rules/RulesList/BankRulesAlerts';
import { BrandingTemplatesAlerts } from '../BrandingTemplates/alerts/BrandingTemplatesAlerts';
import { CashflowAlerts } from '../CashFlow/CashflowAlerts';
import { PaymentMethodsAlerts } from '../Preferences/PaymentMethods/alerts/PaymentMethodsAlerts';
import { SubscriptionAlerts } from '../Subscriptions/alerts/alerts';
import { ManualJournalsAlerts } from '@/containers/Accounting/JournalsLanding/ManualJournalsAlerts';
import { AccountsAlerts } from '@/containers/Accounts/AccountsAlerts';
import { AccountTransactionsAlerts } from '@/containers/CashFlow/AccountTransactions/AccountTransactionsAlerts';
import { BankAccountAlerts } from '@/containers/CashFlow/AccountTransactions/alerts';
import { CustomersAlerts } from '@/containers/Customers/CustomersAlerts';
import { ExpensesAlerts } from '@/containers/Expenses/ExpensesAlerts';
import { InventoryAdjustmentsAlerts } from '@/containers/InventoryAdjustments/InventoryAdjustmentsAlerts';
import { ItemsAlerts } from '@/containers/Items/ItemsAlerts';
import { ItemsCategoriesAlerts } from '@/containers/ItemsCategories/ItemsCategoriesAlerts';
import { BranchesAlerts } from '@/containers/Preferences/Branches/BranchesAlerts';
import { CurrenciesAlerts } from '@/containers/Preferences/Currencies/CurrenciesAlerts';
import { RolesAlerts } from '@/containers/Preferences/Users/Roles/RolesAlerts';
import { UsersAlerts } from '@/containers/Preferences/Users/UsersAlerts';
import { WarehousesAlerts } from '@/containers/Preferences/Warehouses/WarehousesAlerts';
import { ProjectAlerts } from '@/containers/Projects/containers/ProjectAlerts';
import { BillsAlerts } from '@/containers/Purchases/Bills/BillsLanding/BillsAlerts';
import { VendorCreditNotesAlerts } from '@/containers/Purchases/CreditNotes/VendorCreditNotesAlerts';
import { PaymentsMadeAlerts } from '@/containers/Purchases/PaymentsMade/PaymentsMadeAlerts';
import { CreditNotesAlerts } from '@/containers/Sales/CreditNotes/CreditNotesAlerts';
import { EstimatesAlerts } from '@/containers/Sales/Estimates/EstimatesAlerts';
import { InvoicesAlerts } from '@/containers/Sales/Invoices/InvoicesAlerts';
import { PaymentsReceivedAlerts } from '@/containers/Sales/PaymentsReceived/PaymentsReceivedAlerts';
import { ReceiptsAlerts } from '@/containers/Sales/Receipts/ReceiptsAlerts';
import { TaxRatesAlerts } from '@/containers/TaxRates/alerts';
import { TransactionsLockingAlerts } from '@/containers/TransactionsLocking/TransactionsLockingAlerts';
import { VendorsAlerts } from '@/containers/Vendors/VendorsAlerts';
import { WarehousesTransfersAlerts } from '@/containers/WarehouseTransfers/WarehousesTransfersAlerts';
import WorkspacesAlerts from '@/ee/workspaces/containers/Alerts/WorkspacesAlerts';



export const registered = [
  ...AccountsAlerts,
  ...ItemsAlerts,
  ...ItemsCategoriesAlerts,
  ...InventoryAdjustmentsAlerts,
  ...EstimatesAlerts,
  ...InvoicesAlerts,
  ...ReceiptsAlerts,
  ...PaymentsReceivedAlerts,
  ...BillsAlerts,
  ...PaymentsMadeAlerts,
  ...CustomersAlerts,
  ...VendorsAlerts,
  ...ManualJournalsAlerts,
  ...ExpensesAlerts,
  ...AccountTransactionsAlerts,
  ...UsersAlerts,
  ...CurrenciesAlerts,
  ...RolesAlerts,
  ...CreditNotesAlerts,
  ...VendorCreditNotesAlerts,
  ...TransactionsLockingAlerts,
  ...WarehousesAlerts,
  ...WarehousesTransfersAlerts,
  ...BranchesAlerts,
  ...ProjectAlerts,
  ...TaxRatesAlerts,
  ...CashflowAlerts,
  ...BankRulesAlerts,
  ...SubscriptionAlerts,
  ...BankAccountAlerts,
  ...BrandingTemplatesAlerts,
  ...PaymentMethodsAlerts,
  ...WorkspacesAlerts,
];
