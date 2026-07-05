// @ts-nocheck
import classNames from 'classnames';
import React from 'react';
import { CLASSES } from '@/constants/classes';

// Dashboard card.
export function DashboardCard({ children, page }) {
  return (
    <div
      className={classNames(CLASSES.DASHBOARD_CARD, {
        [CLASSES.DASHBOARD_CARD_PAGE]: page,
      })}
    >
      {children}
    </div>
  );
}
