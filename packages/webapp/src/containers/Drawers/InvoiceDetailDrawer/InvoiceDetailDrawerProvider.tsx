import React from 'react';
import intl from 'react-intl-universal';
import { DrawerHeaderContent, DrawerLoading } from '@/components';
import { Features } from '@/constants';
import { useInvoice } from '@/hooks/query';
import { useFeatureCan } from '@/hooks/state';
import { DRAWERS } from '@/constants/drawers';
import type { SaleInvoice } from '@bigcapital/sdk-ts';

export interface InvoiceDetailDrawerContextValue {
  invoiceId: number | undefined;
  invoice: SaleInvoice | undefined;
}

interface InvoiceDetailDrawerProviderProps {
  invoiceId: number | undefined;
}

const InvoiceDetailDrawerContext = React.createContext<
  InvoiceDetailDrawerContextValue | undefined
>(undefined);

/**
 * Invoice detail provider.
 */
function InvoiceDetailDrawerProvider({
  invoiceId,
  ...props
}: InvoiceDetailDrawerProviderProps & { children?: React.ReactNode }) {
  // Features guard.
  const { featureCan } = useFeatureCan();

  // Fetch sale invoice details.
  const { isLoading: isInvoiceLoading, data: invoice } = useInvoice(invoiceId, {
    enabled: !!invoiceId,
  });

  // Provider.
  const provider: InvoiceDetailDrawerContextValue = {
    invoiceId,
    invoice,
  };

  return (
    <DrawerLoading loading={isInvoiceLoading}>
      <DrawerHeaderContent
        name={DRAWERS.INVOICE_DETAILS}
        title={intl.get('invoice_details.drawer.title', {
          invoiceNumber: invoice?.invoiceNo,
        })}
        subTitle={
          featureCan(Features.Branches)
            ? intl.get('invoice_details.drawer.subtitle', {
                value: invoice?.branch?.name,
              })
            : null
        }
      />
      <InvoiceDetailDrawerContext.Provider value={provider} {...props} />
    </DrawerLoading>
  );
}

const useInvoiceDetailDrawerContext = (): InvoiceDetailDrawerContextValue => {
  const ctx = React.useContext(InvoiceDetailDrawerContext);
  if (ctx === undefined) {
    throw new Error(
      'useInvoiceDetailDrawerContext must be used within an InvoiceDetailDrawerProvider',
    );
  }
  return ctx;
};

export { InvoiceDetailDrawerProvider, useInvoiceDetailDrawerContext };
