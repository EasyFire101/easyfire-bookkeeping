import React from 'react';
import { DrawerBody } from '@/components';

import { ReceiptDetail } from './ReceiptDetail';
import { ReceiptDetailDrawerProvider } from './ReceiptDetailDrawerProvider';

interface ReceiptDetailDrawerContentProps {
  receiptId: number | undefined;
}

/**
 * Receipt detail drawer content.
 */
export function ReceiptDetailDrawerContent({
  // #ownProp
  receiptId,
}: ReceiptDetailDrawerContentProps) {
  return (
    <ReceiptDetailDrawerProvider receiptId={receiptId}>
      <DrawerBody>
        <ReceiptDetail />
      </DrawerBody>
    </ReceiptDetailDrawerProvider>
  );
}
