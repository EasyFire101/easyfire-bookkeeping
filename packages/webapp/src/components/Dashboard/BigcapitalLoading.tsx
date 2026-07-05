// @ts-nocheck
import classNames from 'classnames';
import React from 'react';
import { Icon } from '@/components';

import '@/style/components/BigcapitalLoading.scss';
import { useIsDarkMode } from '@/hooks/useDarkMode';

/**
 * Bigcapital logo loading.
 */
export default function BigcapitalLoading({ className }) {
  const isDarkmode = useIsDarkMode();

  return (
    <div className={classNames('bigcapital-loading', className)}>
      <div class="center">
        {isDarkmode ? (
          <Icon
            icon="bigcapital-alt"
            height={37}
            width={228}
            color="#fff"
            className="bigcapital-logo"
          />
        ) : (
          <Icon icon="bigcapital" height={37} width={228} />
        )}
      </div>
    </div>
  );
}
