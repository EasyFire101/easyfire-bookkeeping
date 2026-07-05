// @ts-nocheck
import { Callout, Intent } from '@blueprintjs/core';
import { includes } from 'lodash';
import React from 'react';
import intl from 'react-intl-universal';

export const UserFormCalloutAlerts = ({ calloutCodes }) => {
  return [
    includes(calloutCodes, 200) && (
      <Callout icon={null} intent={Intent.DANGER}>
        {intl.get('roles.error.you_cannot_change_your_own_role')}
      </Callout>
    ),
  ];
};
