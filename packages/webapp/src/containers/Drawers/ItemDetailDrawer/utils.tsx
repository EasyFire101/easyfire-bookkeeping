import React from 'react';
import styled from 'styled-components';
import { Intent, Tag } from '@blueprintjs/core';
import { Choose, FormattedMessage as T } from '@/components';
import type { Item } from '@bigcapital/sdk-ts';

/**
 * Items inactive status badge alongside the item name.
 */
export function inactiveStatus(item: Item | undefined) {
  if (!item) return null;

  return (
    <Choose>
      <Choose.When condition={!item.active}>
        {item.name}
        <StatusTag intent={Intent.NONE} minimal={true} round={true}>
          <T id={'item.details.inactive'} />
        </StatusTag>
      </Choose.When>
      <Choose.Otherwise>{item.name}</Choose.Otherwise>
    </Choose>
  );
}

const StatusTag = styled(Tag)`
  font-size: 11px;
  margin-left: 10px;
`;
