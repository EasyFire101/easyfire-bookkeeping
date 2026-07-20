// @ts-nocheck
import React from 'react';
import { Icon } from '@/components/Icon';
import { EASYFIRE_SOURCE_URL } from '@/constants/legal';

export function AuthCopyright() {
  return (
    <div>
      <Icon width={122} height={22} icon={'bigcapital'} />
      <div>
        <a href={EASYFIRE_SOURCE_URL} target="_blank" rel="noopener noreferrer">
          Source code (AGPL-3.0)
        </a>
      </div>
    </div>
  );
}
