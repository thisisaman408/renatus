import React, { Component, useRef } from 'react';
import { Button } from './components/Button';
import { Input } from './components/Input';

// Top-level component intentionally mixes a class (string-ref antipattern)
// with a useRef() call so a single file trips Rules 1 and 3.
export class App extends Component {
  override componentDidMount() {
    // Rule 3: react-19-string-refs-removal — `ref="legacyInput"` below.
    // Accessing it via this.refs is the legacy contract that React 19 drops.
    // We log it so the side-effect is visible to a reviewer.
    console.log((this as unknown as { refs: Record<string, unknown> }).refs['legacyInput']);
  }

  override render() {
    // Rule 1: react-19-useref-initial-arg — useRef() with no argument.
    // (Calling a hook inside render() of a class is semantically broken; that
    // is intentional — this fixture exists to exercise rule detection, not to
    // be a well-behaved React app.)
    const focusRef = useRef();

    return (
      <div>
        <Input ref="legacyInput" placeholder="legacy string ref" />
        <Button label="Submit" />
        <button
          ref={(el) => {
            (focusRef as { current: HTMLButtonElement | null }).current = el;
          }}
        >
          Modern
        </button>
      </div>
    );
  }
}
