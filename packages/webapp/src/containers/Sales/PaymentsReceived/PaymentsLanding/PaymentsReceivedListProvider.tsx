import React, { createContext, useContext } from 'react';
import { isEmpty } from 'lodash';
import { DashboardInsider } from '@/components/Dashboard';
import {
  useResourceViews,
  useResourceMeta,
  usePaymentReceives,
} from '@/hooks/query';
import { getFieldsFromResourceMeta } from '@/utils';
import type { PaymentReceiveTableRow } from './components';

interface PaymentsReceivedListProviderProps {
  query?: any;
  tableStateChanged?: boolean;
  children?: React.ReactNode;
}

export interface PaymentsReceivedListContextValue {
  paymentReceives: PaymentReceiveTableRow[] | undefined;
  pagination: { total?: number; [key: string]: any } | undefined;
  resourceMeta: any;
  fields: Record<string, any>[];
  paymentReceivesViews: any;
  isPaymentReceivesLoading: boolean;
  isPaymentReceivesFetching: boolean;
  isResourceFetching: boolean;
  isResourceLoading: boolean;
  isViewsLoading: boolean;
  isEmptyStatus: boolean;
}

const PaymentsReceivedListContext =
  createContext<PaymentsReceivedListContextValue>(
    {} as PaymentsReceivedListContextValue,
  );

function PaymentsReceivedListProvider({
  query,
  tableStateChanged,
  ...props
}: PaymentsReceivedListProviderProps) {
  const { data: paymentReceivesViews, isLoading: isViewsLoading } =
    useResourceViews('payment-received');

  const {
    data: resourceMeta,
    isLoading: isResourceLoading,
    isFetching: isResourceFetching,
  } = useResourceMeta('payment-received');

  const {
    data: paymentReceivesData,
    isLoading: isPaymentReceivesLoading,
    isFetching: isPaymentReceivesFetching,
  } = usePaymentReceives(query);

  const isEmptyStatus =
    isEmpty(paymentReceivesData?.data) &&
    !isPaymentReceivesLoading &&
    !tableStateChanged;

  const state: PaymentsReceivedListContextValue = {
    paymentReceives: paymentReceivesData?.data,
    pagination: paymentReceivesData?.pagination,

    resourceMeta,
    fields: resourceMeta?.fields
      ? getFieldsFromResourceMeta(resourceMeta.fields)
      : [],

    paymentReceivesViews,

    isPaymentReceivesLoading,
    isPaymentReceivesFetching,
    isResourceFetching,
    isResourceLoading,
    isViewsLoading,
    isEmptyStatus,
  };

  return (
    <DashboardInsider
      loading={isViewsLoading || isResourceLoading}
      name={'payment-receives-list'}
    >
      <PaymentsReceivedListContext.Provider value={state} {...props} />
    </DashboardInsider>
  );
}

const usePaymentsReceivedListContext = () =>
  useContext(PaymentsReceivedListContext);

export { PaymentsReceivedListProvider, usePaymentsReceivedListContext };
