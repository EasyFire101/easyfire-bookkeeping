import React from 'react';
import { Spinner } from '@blueprintjs/core';

interface TableLoadingProps {
  spinnerProps?: Record<string, any>;
}

export default function TableLoading({ spinnerProps }: TableLoadingProps) {
  return (
    <div className="loading">
      <Spinner {...spinnerProps} />
    </div>
  );
}
