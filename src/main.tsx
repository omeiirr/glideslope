import { render } from 'preact';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './ui/styles.css';
import { App } from './ui/App';

render(<App />, document.getElementById('app')!);
