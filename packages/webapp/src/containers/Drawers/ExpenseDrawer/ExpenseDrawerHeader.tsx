// @ts-nocheck
import React from 'react';
import styled from 'styled-components';
import { defaultTo } from 'lodash';

import {
  CommercialDocHeader,
  CommercialDocTopHeader,
  Row,
  Col,
  DetailItem,
  DetailsMenu,
  ExchangeRateDetailItem,

} from '@/components';
import { useExpenseDrawerContext } from './ExpenseDrawerProvider';
import { ExpenseDetailsStatus } from './components';
import intl from 'react-intl-universal';

/**
 * Expense drawer content.
 */
export function ExpenseDrawerHeader() {
  const { expense } = useExpenseDrawerContext();

  return (
    <CommercialDocHeader>
      <CommercialDocTopHeader>
        <DetailsMenu>
          <DetailItem name={'amount'} label={intl.get('full_amount')}>
            <h3 class="big-number">{expense.formatted_amount}</h3>
          </DetailItem>

          <StatusDetailItem>
            <ExpenseDetailsStatus expense={expense} />
          </StatusDetailItem>
        </DetailsMenu>
      </CommercialDocTopHeader>

      <Row>
        <Col xs={6}>
          <DetailsMenu direction={'horizantal'} minLabelSize={'180px'}>
            <DetailItem name={'date'} label={intl.get('date')}>
              {expense.formatted_date}
            </DetailItem>

            <DetailItem name={'reference'} label={intl.get('reference_no')}>
              {defaultTo(expense.reference_no, '-')}
            </DetailItem>

            <DetailItem label={intl.get('description')}>
              {defaultTo(expense.description, '—')}
            </DetailItem>
            <ExchangeRateDetailItem
              exchangeRate={expense?.exchange_rate}
              toCurrency={expense?.currency_code}
            />
          </DetailsMenu>
        </Col>

        <Col xs={6}>
          <DetailsMenu
            textAlign={'right'}
            direction={'horizantal'}
            minLabelSize={'180px'}
          >
            <DetailItem label={intl.get('published_at')}>
              {expense.formatted_published_at || '—'}
            </DetailItem>

            <DetailItem label={intl.get('created_at')}>
              {expense.formatted_created_at} 
            </DetailItem>
          </DetailsMenu>
        </Col>
      </Row>
    </CommercialDocHeader>
  );
}

const StatusDetailItem = styled(DetailItem)`
  width: 50%;
  text-align: right;
  position: relative;
  top: -5px;
`;
