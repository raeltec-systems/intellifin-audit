import { Banner } from '../design/Banner';
import { Button } from '../design/Button';

export function SectionConflict({ conflict, dirty = false, name, reset }: { conflict: boolean; dirty?: boolean; name: string; reset: () => void }): React.JSX.Element | null {
  return conflict || dirty ? <div className="ls-stack">{conflict ? <Banner tone="warning" title={`${name} changed in another session. Review the saved values before replacing them.`} /> : <p>{name} has unsaved changes.</p>}<Button type="button" onClick={reset}>Use saved {name}</Button></div> : null;
}
