import React from 'react';
import type { Account, AccountTransactionsList } from '@bigcapital/sdk-ts';
import { useAccount, useAccountTransactions } from '@/hooks/query';
import { DrawerHeaderContent, DrawerLoading } from '@/components';
import { DRAWERS } from '@/constants/drawers';

interface AccountDrawerContextValue {
  accountId: number;
  account: Account | undefined;
  accounts: AccountTransactionsList | undefined;
  drawerName: string;
}

const AccountDrawerContext =
  React.createContext<AccountDrawerContextValue | null>(null);

interface AccountDrawerProviderProps {
  accountId: number;
  name: string;
  children?: React.ReactNode;
}

/**
 * Account drawer provider.
 */
function AccountDrawerProvider({
  accountId,
  name,
  children,
}: AccountDrawerProviderProps) {
  // Fetches the specific account details.
  const { data: account, isLoading: isAccountLoading } = useAccount(accountId, {
    enabled: !!accountId,
  });

  // Load the specific account transactions.
  const { data: accounts, isLoading: isAccountsLoading } =
    useAccountTransactions(accountId, {
      enabled: !!accountId,
    });

  // Drawer title.
  const drawerTitle = `${account?.name ?? ''} ${account?.code ?? ''}`.trim();

  // Provider.
  const provider: AccountDrawerContextValue = {
    accountId,
    account,
    accounts,
    drawerName: name,
  };

  return (
    <DrawerLoading loading={isAccountLoading || isAccountsLoading} mount={false}>
      <DrawerHeaderContent name={DRAWERS.ACCOUNT_DETAILS} title={drawerTitle} />
      <AccountDrawerContext.Provider value={provider}>
        {children}
      </AccountDrawerContext.Provider>
    </DrawerLoading>
  );
}

const useAccountDrawerContext = () => {
  const ctx = React.useContext(AccountDrawerContext);
  if (!ctx)
    throw new Error(
      'useAccountDrawerContext must be used within AccountDrawerProvider',
    );
  return ctx;
};

export { AccountDrawerProvider, useAccountDrawerContext };
