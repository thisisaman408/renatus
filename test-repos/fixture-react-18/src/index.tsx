import React from 'react';
import ReactDOM from 'react-dom';
import { App } from './App';

// Rule 4: react-19-reactdom-render-removal — ReactDOM.render() is gone in v19.
ReactDOM.render(<App />, document.getElementById('root'));
