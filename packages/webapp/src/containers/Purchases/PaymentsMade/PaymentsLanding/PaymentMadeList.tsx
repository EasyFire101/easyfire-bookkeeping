import React from 'react';

import '@/style/pages/PaymentMade/List.scss';

import { DashboardPageContent } from '@/components';
import { PaymentMadesListProvider } from './PaymentMadesListProvider';
import { PaymentMadeActionsBar } from './PaymentMadeActionsBar';
import { PaymentMadesTable } from './PaymentMadesTable';
import { PaymentMadeListDrawers } from './PaymentMadeListDrawers';

import { withPaymentMade } from './withPaymentMade';
import type { WithPaymentMadeProps } from './withPaymentMade';
import { withPaymentMadeActions } from './withPaymentMadeActions';

import { compose, transformTableStateToQuery } from '@/utils';

interface WithPaymentMadeActionsProps {
  resetPaymentMadesTableState: () => void;
}

interface PaymentMadeListProps
  extends Pick<
    WithPaymentMadeProps,
    'paymentMadesTableState' | 'paymentsTableStateChanged'
  >,
    WithPaymentMadeActionsProps {}

function PaymentMadeListInner({
  paymentMadesTableState,
  paymentsTableStateChanged,
  resetPaymentMadesTableState,
}: PaymentMadeListProps) {
  React.useEffect(
    () => () => {
      resetPaymentMadesTableState();
    },
    [resetPaymentMadesTableState],
  );

  return (
    <PaymentMadesListProvider
      query={transformTableStateToQuery(paymentMadesTableState)}
      tableStateChanged={paymentsTableStateChanged}
    >
      <PaymentMadeActionsBar />
      <PaymentMadeListDrawers />

      <DashboardPageContent>
        <PaymentMadesTable />
      </DashboardPageContent>
    </PaymentMadesListProvider>
  );
}

export const PaymentMadeList = compose(
  withPaymentMade(({ paymentMadesTableState, paymentsTableStateChanged }) => ({
    paymentMadesTableState,
    paymentsTableStateChanged,
  })),
  withPaymentMadeActions,
)(PaymentMadeListInner);
