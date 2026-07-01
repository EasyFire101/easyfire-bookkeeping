import type { ComponentProps } from 'react';
import { Button } from '@blueprintjs/core';
import styles from './TagButton.module.scss';

type TagButtonProps = Omit<ComponentProps<typeof Button>, 'className'> & {
  className?: string;
};

export function TagButton(props: TagButtonProps) {
  return <Button {...props} className={styles.root} />;
}
