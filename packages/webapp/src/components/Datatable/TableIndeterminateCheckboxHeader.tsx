import React from 'react';
import { Checkbox } from '@blueprintjs/core';

interface TableIndeterminateCheckboxHeaderProps {
  getToggleAllRowsSelectedProps: () => Record<string, any>;
}

export default function TableIndeterminateCheckboxHeader({
  getToggleAllRowsSelectedProps,
}: TableIndeterminateCheckboxHeaderProps) {
  return (
    <div>
      <Checkbox {...getToggleAllRowsSelectedProps()} />
    </div>
  );
}
