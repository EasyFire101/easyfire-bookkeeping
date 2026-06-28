import React from 'react';

import '@/style/components/Drawers/ItemDrawer.scss';

import { DrawerBody } from '@/components';
import { ItemDetail as ItemContentDetails } from './ItemContentDetails';
import { ItemDetailDrawerProvider } from './ItemDetailDrawerProvider';

interface ItemDetailDrawerContentProps {
  itemId: number | undefined;
}

/**
 * Item detail drawer content.
 */
export function ItemDetailDrawerContent({
  itemId,
}: ItemDetailDrawerContentProps) {
  return (
    <ItemDetailDrawerProvider itemId={itemId}>
      <DrawerBody>
        <ItemContentDetails />
      </DrawerBody>
    </ItemDetailDrawerProvider>
  );
}
