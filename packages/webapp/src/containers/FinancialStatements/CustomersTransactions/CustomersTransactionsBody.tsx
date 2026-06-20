import { CustomersTransactionsTable } from './CustomersTransactionsTable';
import { FinancialReportBody } from '../FinancialReportPage';
import { FinancialSheetSkeleton } from '@/components/FinancialSheet';
import { useCustomersTransactionsContext } from './CustomersTransactionsProvider';
import { useCurrentOrganizationName } from '@/hooks/query';

/**
 * Customers transactions body.
 */
function CustomersTransactionsBodyJSX() {
  const organizationName = useCurrentOrganizationName();
  const { isCustomersTransactionsLoading } = useCustomersTransactionsContext();

  return (
    <FinancialReportBody>
      {isCustomersTransactionsLoading ? (
        <FinancialSheetSkeleton />
      ) : (
        <CustomersTransactionsTable companyName={organizationName} />
      )}
    </FinancialReportBody>
  );
}

export const CustomersTransactionsBody = CustomersTransactionsBodyJSX;
