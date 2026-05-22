import type { ApplicationState } from '@/store/reducers';

export type MapState<MappedProps, OwnProps = unknown> = (
  mapped: MappedProps,
  state: ApplicationState,
  ownProps: OwnProps,
) => Partial<MappedProps> | Record<string, unknown>;
