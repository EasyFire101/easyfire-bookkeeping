  import React, { createContext, useContext } from 'react';
import { FinancialHeaderLoadingSkeleton } from '../FinancialHeaderLoadingSkeleton';
import { useCustomers } from '@/hooks/query';

type UseCustomersResult = ReturnType<typeof useCustomers>;

type CustomersBalanceSummaryGeneralContextValue = {
  isCustomersLoading: boolean;
  isCustomersFetching: boolean;
  customers: UseCustomersResult['data'] extends { customers: infer C } ? C : unknown;
};

type CustomersBalanceSummaryGeneralProviderProps = {
  children?: React.ReactNode;
};

const CustomersBalanceSummaryGeneralContext = createContext<
  CustomersBalanceSummaryGeneralContextValue | undefined
>(undefined);

function CustomersBalanceSummaryGeneralProvider({
  ...props
}: CustomersBalanceSummaryGeneralProviderProps) {
  const {
    data: customersData,
    isFetching: isCustomersFetching,
    isLoading: isCustomersLoading,
  } = useCustomers();

  const provider: CustomersBalanceSummaryGeneralContextValue = {
    isCustomersLoading,
    isCustomersFetching,
    customers: (customersData as any)?.customers,
  };

  return isCustomersLoading ? (
    <FinancialHeaderLoadingSkeleton />
  ) : (
    <CustomersBalanceSummaryGeneralContext.Provider
      value={provider}
      {...props}
    />
  );
}

const useCustomersBalanceSummaryGeneralContext =
  (): CustomersBalanceSummaryGeneralContextValue => {
    const ctx = useContext(CustomersBalanceSummaryGeneralContext);
    if (!ctx) {
      throw new Error(
        'useCustomersBalanceSummaryGeneralContext must be used within CustomersBalanceSummaryGeneralProvider',
      );
    }
    return ctx;
  };

export {
  CustomersBalanceSummaryGeneralProvider,
  useCustomersBalanceSummaryGeneralContext,
};
