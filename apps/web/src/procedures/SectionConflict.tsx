import { Banner } from '../design/Banner';
import { Button } from '../design/Button';

export function SectionConflict({ conflict, name, reset }: { conflict: boolean; name: string; reset: () => void }): React.JSX.Element | null {
  return conflict ? <div className="ls-stack"><Banner tone="warning" title={`${name} changed in another session. Review the saved values before replacing them.`} /><Button type="button" onClick={reset}>Use saved {name}</Button></div> : null;
}
