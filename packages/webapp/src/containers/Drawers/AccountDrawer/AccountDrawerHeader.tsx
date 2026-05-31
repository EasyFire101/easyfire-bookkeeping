// @ts-nocheck
import React from 'react';
import { isEmpty } from 'lodash';

import {
  Icon,
  DetailsMenu,
  DetailItem,

} from '@/components';
import { useAccountDrawerContext } from './AccountDrawerProvider';
import intl from 'react-intl-universal';

/**
 *  Account drawer header.
 */
export function AccountDrawerHeader() {
  const { account } = useAccountDrawerContext();

  return (
    <div className={'account-drawer__content-header'}>
      <DetailsMenu>
        <DetailItem
          name={'closing-balance'}
          label={intl.get('closing_balance')}
        >
          <h3 class={'big-number'}>{account.formatted_amount}</h3>
        </DetailItem>

        <DetailItem name={'account-type'} label={intl.get('account_type')}>
          {account.account_type_label}
        </DetailItem>

        <DetailItem name={'account-normal'} label={intl.get('account_normal')}>
          {account.account_normal_formatted}
          <Icon
            iconSize={14}
            icon={`arrow-${
              account.account_normal === 'credit' ? 'down' : 'up'
            }`}
          />
        </DetailItem>

        <DetailItem name={'code'} label={intl.get('code')}>
          {account.code}
        </DetailItem>

        <DetailItem name={'currency'} label={intl.get('currency')}>
          {account.currency_code}
        </DetailItem>
      </DetailsMenu>

      <DetailsMenu direction={'horizantal'}>
        <DetailItem name={'description'} label={intl.get('description')}>
          {!isEmpty(account.description) ? account.description : '--'}
        </DetailItem>
      </DetailsMenu>
    </div>
  );
}
