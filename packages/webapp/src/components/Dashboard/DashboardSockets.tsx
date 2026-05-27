import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { AccountsQueryKeys } from '@/hooks/query/accounts';
import { CashflowAccountsQueryKeys } from '@/hooks/query/cashflow-accounts';
import { AppToaster } from '@/components';
import { Intent } from '@blueprintjs/core';

export function DashboardSockets() {
  const socket = useRef<any>();
  const client = useQueryClient();

  useEffect(() => {
    socket.current = io('/', { path: '/socket' });
  
    socket.current.on('NEW_TRANSACTIONS_DATA', () => {
      client.invalidateQueries({ queryKey: [AccountsQueryKeys.ACCOUNTS] });
      client.invalidateQueries({ queryKey: [AccountsQueryKeys.ACCOUNT_TRANSACTION] });
      client.invalidateQueries({ queryKey: [CashflowAccountsQueryKeys.CASH_FLOW_ACCOUNTS] });
      client.invalidateQueries({ queryKey: [CashflowAccountsQueryKeys.CASH_FLOW_TRANSACTIONS] });

      AppToaster.show({
        message: 'The Plaid connected accounts have been updated.',
        intent: Intent.SUCCESS,
      });
    });
    socket.current.on('SUBSCRIPTION_CHANGED', () => {
      client.invalidateQueries({ queryKey: ['GetSubscriptions'] });
    });
    socket.current.on('WORKSPACES_CHANGED', () => {
      client.invalidateQueries(['workspaces']);
    });
    return () => {
      socket.current.removeAllListeners();
      socket.current.close();
    };
  }, []);
}
