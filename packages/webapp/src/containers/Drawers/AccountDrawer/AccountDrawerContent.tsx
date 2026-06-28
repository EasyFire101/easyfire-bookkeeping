import React from 'react';
import { DrawerBody } from '@/components';
import '@/style/components/Drawers/AccountDrawer.scss';
import { AccountDrawerProvider } from './AccountDrawerProvider';
import { AccountDrawerDetails } from './AccountDrawerDetails';

interface AccountDrawerContentProps {
  accountId: number | undefined;
  name: string;
}

/**
 * Account drawer content.
 */
export function AccountDrawerContent({
  // #ownProp
  accountId,
  name,
}: AccountDrawerContentProps) {
  return (
    <AccountDrawerProvider name={name} accountId={accountId}>
      <DrawerBody>
        <AccountDrawerDetails />
      </DrawerBody>
    </AccountDrawerProvider>
  );
}
