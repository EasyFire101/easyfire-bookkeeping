import { pipe } from 'fp-ts/function';
import { FinancialReportBody } from '../FinancialReportPage';
import { FinancialSheetSkeleton } from '@/components/FinancialSheet';
import { useSalesByItemsContext } from './SalesByItemProvider';
import { SalesByItemsTable } from './SalesByItemsTable';
import { withCurrentOrganization } from '@/containers/Organization/withCurrentOrganization';

interface SalesByItemsBodyOwnProps {}
interface SalesByItemsWithCurrentOrganizationProps {
  organizationName: string;
}
type SalesByItemsBodyJSXProps = SalesByItemsBodyOwnProps &
  SalesByItemsWithCurrentOrganizationProps;

/**
 * Sales by items body.
 */
function SalesByItemsBodyJSX({ organizationName }: SalesByItemsBodyJSXProps) {
  const { isLoading } = useSalesByItemsContext();

  return (
    <FinancialReportBody>
      {isLoading ? (
        <FinancialSheetSkeleton />
      ) : (
        <SalesByItemsTable companyName={organizationName} />
      )}
    </FinancialReportBody>
  );
}

export const SalesByItemsBody = pipe(
  SalesByItemsBodyJSX,
  withCurrentOrganization(({ organization }) => ({
    organizationName: organization.name,
  })),
);
