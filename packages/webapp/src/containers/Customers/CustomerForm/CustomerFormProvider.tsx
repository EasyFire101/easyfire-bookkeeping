import React, { createContext, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  useCustomer,
  useCurrencies,
  useCreateCustomer,
  useEditCustomer,
  useContact,
  useBranches,
} from '@/hooks/query';
import { Features } from '@/constants';
import { useFeatureCan } from '@/hooks/state';

type CustomerFormSubmitPayload = {
  noRedirect?: boolean;
};

type Customer = {
  id: number;
  [key: string]: any;
};

type Currency = {
  currency_code: string;
  [key: string]: any;
};

type Branch = {
  id: number;
  primary?: boolean;
  [key: string]: any;
};

type CustomerFormContextValue = {
  customerId?: number;
  customer?: Customer;
  currencies: Currency[];
  branches: Branch[];
  contactDuplicate?: Customer;
  submitPayload: CustomerFormSubmitPayload;
  isNewMode: boolean;

  isCustomerLoading: boolean;
  isCurrenciesLoading: boolean;
  isBranchesSuccess: boolean;
  isFormLoading: boolean;

  setSubmitPayload: React.Dispatch<
    React.SetStateAction<CustomerFormSubmitPayload>
  >;

  editCustomerMutate: (args: [number, any]) => Promise<any>;
  createCustomerMutate: (values: any) => Promise<any>;
};

type CustomerFormProviderProps = {
  query?: unknown;
  customerId?: number;
  children?: React.ReactNode;
};

const CustomerFormContext = createContext<CustomerFormContextValue | undefined>(
  undefined,
);

export function CustomerFormProvider({ query, customerId, children }: CustomerFormProviderProps) {
  const { state } = useLocation<{ action?: number | string }>();
  const contactId = state?.action;

  // Features guard.
  const { featureCan } = useFeatureCan();
  const isBranchFeatureCan = featureCan(Features.Branches);

  // Handle fetch customer details.
  const { data: customer, isLoading: isCustomerLoading } = useCustomer(
    customerId,
    { enabled: !!customerId },
  );
  // Handle fetch contact duplicate details.
  const { data: contactDuplicate, isLoading: isContactLoading } = useContact(
    contactId,
    { enabled: !!contactId },
  );
  // Handle fetch Currencies data table
  const { data: currencies, isLoading: isCurrenciesLoading } = useCurrencies(undefined);

  // Fetches the branches list.
  const {
    data: branches,
    isLoading: isBranchesLoading,
    isSuccess: isBranchesSuccess,
  } = useBranches(query, { enabled: isBranchFeatureCan });

  // Form submit payload.
  const [submitPayload, setSubmitPayload] = useState<CustomerFormSubmitPayload>({});

  const editCustomerMutation = useEditCustomer(undefined) as any;
  const createCustomerMutation = useCreateCustomer(undefined) as any;
  const editCustomerMutate = editCustomerMutation.mutateAsync as CustomerFormContextValue['editCustomerMutate'];
  const createCustomerMutate =
    createCustomerMutation.mutateAsync as CustomerFormContextValue['createCustomerMutate'];

  // determines whether the form new or duplicate mode.
  const isNewMode = Boolean(contactId) || !customerId;

  const isFormLoading =
    isCustomerLoading || isCurrenciesLoading || isBranchesLoading;

  const provider: CustomerFormContextValue = {
    customerId,
    customer: customer as Customer | undefined,
    currencies: (currencies as Currency[]) ?? [],
    branches: (branches as Branch[]) ?? [],
    contactDuplicate: contactDuplicate as Customer | undefined,
    submitPayload,
    isNewMode,

    isCustomerLoading,
    isCurrenciesLoading,
    isBranchesSuccess,
    isFormLoading,

    setSubmitPayload,
    editCustomerMutate,
    createCustomerMutate,
  };

  return (
    <CustomerFormContext.Provider value={provider}>
      {children}
    </CustomerFormContext.Provider>
  );
}

export const useCustomerFormContext = () => {
  const ctx = React.useContext(CustomerFormContext);
  if (!ctx) {
    throw new Error(
      'useCustomerFormContext must be used within a CustomerFormProvider',
    );
  }
  return ctx;
};
