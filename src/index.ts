import * as blessed from 'blessed';
import * as contrib from 'blessed-contrib';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

type FocusPanel = 'categories' | 'items' | 'output';

interface CommandItem {
  name: string;
  command?: string;
  type: 'command' | 'copy' | 'internal';
  action?: string;
}

interface Category {
  name: string;
  items: CommandItem[];
}

interface CommandsConfig {
  categories: Category[];
}

interface ExtendedList extends blessed.Widgets.ListElement {
  selected: number;
  items: string[];
}

interface ExtendedBox extends blessed.Widgets.BoxElement {
  style: {
    border: { fg: string };
    focus: { border: { fg: string } };
  };
}

interface ExtendedScreen extends blessed.Widgets.Screen {
  categoriesList: ExtendedList;
  itemsList: ExtendedList;
  outputText: blessed.Widgets.Log;
}

class CommandRunner {
  private screen: ExtendedScreen;
  private categories: Category[];
  private currentCategoryIndex: number = 0;
  private currentItemIndex: number = 0;
  private focusedPanel: FocusPanel = 'categories';
  private outputHistory: string[] = [];

  constructor() {
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'Command Runner',
      fullUnicode: true,
      debug: true,
    }) as ExtendedScreen;

    // Load commands from JSON file
    const configPath = path.join(__dirname, 'commands.json');
    const config: CommandsConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    this.categories = config.categories;

    this.setupUI();
    this.setupKeyBindings();
  }

  private setupUI() {
    // Calculate column widths
    const width = process.stdout.columns;
    const categoryWidth = Math.floor(width * 0.2);
    const itemWidth = Math.floor(width * 0.3);
    const outputWidth = width - categoryWidth - itemWidth - 2; // -2 for borders

    // Categories panel (left)
    const categoriesBox = blessed.box({
      parent: this.screen,
      left: 0,
      top: 0,
      width: categoryWidth,
      height: '100%-1', // Leave space for status bar
      border: { type: 'line' },
      label: ' Categories ',
      style: {
        border: { fg: 'blue' },
        focus: { border: { fg: 'green' } },
      },
    }) as ExtendedBox;

    const categoriesList = blessed.list({
      parent: categoriesBox,
      left: 1,
      top: 1,
      right: 1,
      bottom: 1,
      keys: true,
      vi: true,
      mouse: true,
      interactive: true,
      items: this.categories.map(cat => cat.name),
      style: {
        selected: { bg: 'blue', fg: 'white' },
        focus: { bg: 'green', fg: 'white' },
      },
    }) as ExtendedList;

    // Items panel (center)
    const itemsBox = blessed.box({
      parent: this.screen,
      left: categoryWidth,
      top: 0,
      width: itemWidth,
      height: '100%-1', // Leave space for status bar
      border: { type: 'line' },
      label: ' Items ',
      style: {
        border: { fg: 'blue' },
        focus: { border: { fg: 'green' } },
      },
    }) as ExtendedBox;

    const itemsList = blessed.list({
      parent: itemsBox,
      left: 1,
      top: 1,
      right: 1,
      bottom: 1,
      keys: true,
      vi: true,
      mouse: true,
      interactive: true,
      style: {
        selected: { bg: 'blue', fg: 'white' },
        focus: { bg: 'green', fg: 'white' },
      },
    }) as ExtendedList;

    // Output panel (right)
    const outputBox = blessed.box({
      parent: this.screen,
      left: categoryWidth + itemWidth,
      top: 0,
      width: outputWidth,
      height: '100%-1', // Leave space for status bar
      border: { type: 'line' },
      label: ' Output ',
      scrollable: true,
      style: {
        border: { fg: 'blue' },
        focus: { border: { fg: 'green' } },
      },
    }) as ExtendedBox;

    const outputText = blessed.log({
      parent: outputBox,
      left: 1,
      top: 1,
      right: 1,
      bottom: 1,
      scrollable: true,
      alwaysScroll: true,
      mouse: true,
      keys: true,
      vi: true,
      fg: 'white',
      selectedFg: 'white',
    });

    // Status bar
    const statusBar = blessed.box({
      parent: this.screen,
      left: 0,
      bottom: 0,
      width: '100%',
      height: 1,
      content: '↑↓: Navigate | Tab: Switch Panel | Enter: Select | q: Quit',
      style: {
        bg: 'blue',
        fg: 'white',
      },
    });

    // Update items when category changes
    categoriesList.on('select', (item, index) => {
      this.currentCategoryIndex = index;
      this.currentItemIndex = 0;
      itemsList.setItems(this.categories[index].items.map(item => item.name));
      this.screen.render();
    });

    // Handle item selection
    itemsList.on('select', async (item, index) => {
      const selectedItem = this.categories[this.currentCategoryIndex].items[index];
      
      if (selectedItem.type === 'command' && selectedItem.command) {
        try {
          outputText.log(`$ ${selectedItem.command}`);
          this.screen.render();
          
          const { stdout, stderr } = await execAsync(selectedItem.command);
          if (stdout) outputText.log(stdout);
          if (stderr) outputText.log(`Error: ${stderr}`);
        } catch (error: unknown) {
          if (error instanceof Error) {
            outputText.log(`Error: ${error.message}`);
          } else {
            outputText.log('An unknown error occurred');
          }
        }
        this.screen.render();
      } else if (selectedItem.type === 'copy') {
        // Copy to clipboard (requires pbcopy on macOS)
        try {
          await execAsync(`echo "${selectedItem.name}" | pbcopy`);
          outputText.log(`Copied to clipboard: ${selectedItem.name}`);
        } catch (error: unknown) {
          if (error instanceof Error) {
            outputText.log(`Error copying to clipboard: ${error.message}`);
          } else {
            outputText.log('An unknown error occurred while copying to clipboard');
          }
        }
        this.screen.render();
      } else if (selectedItem.type === 'internal' && selectedItem.action) {
        // Handle internal commands for app control
        if (selectedItem.action === 'clear-output') {
          outputText.setContent('');
        }
        this.screen.render();
      }
    });

    // Initial focus
    if (this.categories.length > 0) {
      itemsList.setItems(this.categories[0].items.map(item => item.name));
    }

    // Store references
    this.screen.categoriesList = categoriesList;
    this.screen.itemsList = itemsList;
    this.screen.outputText = outputText;
    
    // Set initial focus
    categoriesList.focus();
  }

  private setFocus(panel: FocusPanel) {
    this.focusedPanel = panel;
    
    // Remove focus from all panels
    const categoriesBox = this.screen.categoriesList.parent as ExtendedBox;
    const itemsBox = this.screen.itemsList.parent as ExtendedBox;
    const outputBox = this.screen.outputText.parent as ExtendedBox;
    
    categoriesBox.style.border.fg = 'blue';
    itemsBox.style.border.fg = 'blue';
    outputBox.style.border.fg = 'blue';
    
    // Set focus on the selected panel
    if (panel === 'categories') {
      categoriesBox.style.border.fg = 'green';
      this.screen.categoriesList.focus();
    } else if (panel === 'items') {
      itemsBox.style.border.fg = 'green';
      this.screen.itemsList.focus();
    } else if (panel === 'output') {
      outputBox.style.border.fg = 'green';
      this.screen.outputText.focus();
    }
    
    this.screen.render();
  }

  private setupKeyBindings() {
    this.screen.key(['escape', 'q', 'C-c'], () => {
      process.exit(0);
    });

    this.screen.key('tab', () => {
      const panels: FocusPanel[] = ['categories', 'items', 'output'];
      const currentIndex = panels.indexOf(this.focusedPanel);
      const nextPanel = panels[(currentIndex + 1) % panels.length];
      this.setFocus(nextPanel);
    });

    this.screen.key('enter', () => {
      if (this.focusedPanel === 'categories') {
        const index = this.screen.categoriesList.selected;
        this.screen.categoriesList.emit('select', this.screen.categoriesList.items[index], index);
        this.setFocus('items');
      }
    });
  }

  public start() {
    this.setFocus('categories');
    this.screen.render();
  }
}

// Start the application
const app = new CommandRunner();
app.start(); 