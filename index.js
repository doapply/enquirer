'use strict';

var debug = require('debug')('enquirer');
var Emitter = require('component-emitter');
var Separator = require('choices-separator');
var visit = require('collection-visit');
var Question = require('prompt-question');
var extend = require('extend-shallow');
var reduce = require('promise-reduce');
var isObject = require('isobject');
var get = require('get-value');
var set = require('set-value');
var UI = require('readline-ui');

/**
 * Create an instance of `Enquirer` with the given `options`.
 *
 * ```js
 * var Enquirer = require('enquirer');
 * var enquirer = new Enquirer();
 * ```
 * @param {Object} `options`
 * @api public
 */

function Enquirer(options) {
  debug('initializing from <%s>', __filename);

  if (!(this instanceof Enquirer)) {
    return new Enquirer(options);
  }

  this.session = false;
  this.options = options || {};
  this.answers = this.options.answers || {};
  this.questions = {};
  this.prompts = {};
  this.queue = [];
}

/**
 * Initialize Enquirer defaults
 */

Enquirer.prototype.init = function() {
  if (!this.prompts.hasOwnProperty('input')) {
    this.register('input', require('prompt-base'));
  }

  this.UI = this.options.UI || UI;
  this.ui = this.UI.create(this.options);
  this.ui.once('finish', function() {
    this.session = false;
    this.close = null;
    this.queue = [];
    this.emit('finish');
  }.bind(this));

  this.finish = this.ui.finish.bind(this.ui);
  this.close = this.ui.close.bind(this.ui);
  this.emit('init', this);
};

/**
 * Lazily initialize Enquirer defaults
 */

Enquirer.prototype.lazyInit = function() {
  if (this.initialized) return;
  this.initialized = true;
  this.init();
};

/**
 * Register a new prompt `type` with the given `fn`.
 *
 * ```js
 * enquirer.register('confirm', require('enquirer-prompt-confirm'));
 * ```
 * @param {String} `type` The name of the prompt type
 * @param {Function} `fn` Prompt function that inherits from [prompt-base][].
 * @return {Object} Returns the Enquirer instance for chaining.
 * @api public
 */

Enquirer.prototype.register = function(type, PromptType) {
  if (isObject(type)) {
    return this.visit('register', type);
  }
  this.prompts[type] = PromptType;
  return this;
};

/**
 * Invoke a plugin `fn`
 *
 * ```js
 * enquirer.use(require('some-enquirer-plugin'));
 * ```
 * @param {Function} `fn` Function that takes an instance of `Enquirer`
 * @return {Object} Returns the instance for chaining.
 * @api public
 */

Enquirer.prototype.use = function(fn) {
  fn.call(this, this);
  return this;
};

/**
 * Create question `name` with the given `message` and `options`.
 * Uses [enquirer-question][], visit that library for additional details.
 *
 * ```js
 * enquirer.question('color', 'What is your favorite color?');
 * enquirer.question('color', 'What is your favorite color?', {
 *   default: 'blue'
 * });
 * enquirer.question('color', {
 *   message: 'What is your favorite color?',
 *   default: 'blue'
 * });
 * enquirer.question({
 *   name: 'color',
 *   message: 'What is your favorite color?',
 *   default: 'blue'
 * });
 * enquirer.question({
 *   name: 'color',
 *   type: 'input', // "input" is the default prompt type and doesn't need to be specified
 *   message: 'What is your favorite color?',
 *   default: 'blue'
 * });
 * ```
 * @emits `question`
 * @param {String|Object} `name` Name or options object
 * @param {String|Object} `message` Message or options object
 * @param {Object} `options`
 * @return {Object} Returns the created question object
 * @api public
 */

Enquirer.prototype.question = function(name, message, options) {
  if (arguments.length === 1 && typeof name === 'string') {
    name = this.questions[name] || name;
  }

  var opts = extend({}, this.options, options);
  var question = new Question(name, message, opts);
  this.questions[question.name] = question;
  this.emit('question', question);
  return question;
};

Enquirer.prototype.set = function() {
  this.question.apply(this, arguments);
  return this;
};

Enquirer.prototype.get = function(name) {
  return get(this.questions, name);
};

Enquirer.prototype.has = function(name) {
  return this.questions.hasOwnProperty(name);
};

/**
 * Enqueue one or more questions.
 *
 * @param {Object|Array|String} `questions`
 * @return {Array} Returns an array of question names
 */

Enquirer.prototype.enqueue = function(questions) {
  if (typeof questions === 'string') {
    questions = this.question(questions);
  }
  if (isObject(questions)) {
    questions = [questions];
  }
  if (Array.isArray(questions) && questions.length) {
    return (this.queue = questions);
  }
  this.queue = Object.keys(this.questions);
  return this.queue;
};

/**
 * Initialize a prompt session for one or more questions.
 *
 * ```js
 * var Enquirer = require('enquirer');
 * var enquirer = new Enquirer();
 *
 * enquirer.question('first', 'First name?');
 * enquirer.question('last', 'Last name?');
 *
 * enquirer.ask('first')
 *   .then(function(answers) {
 *     console.log(answers)
 *   });
 *
 * // errors
 * enquirer.ask('first')
 *   .then(function(answers) {
 *     console.log(answers)
 *   })
 *   .catch(function(err) {
 *     console.log(err)
 *   });
 * ```
 * @emits `ask` With the array of `questions` to be asked
 * @return {Array|Object} `questions` One or more question objects or names of registered questions.
 * @api public
 */

Enquirer.prototype.ask = function(questions) {
  this.lazyInit();
  this.session = true;
  var queue = this.enqueue(questions);
  var prompt = this.prompt.bind(this);
  var self = this;

  function ask(answers, question) {
    self.emit('ask', question, answers);
    return prompt(question);
  }

  return Promise.resolve(queue)
    .then(reduce(ask, this.answers));
};

/**
 * Initialize a prompt session for a single question. Used by the [ask](#ask) method.
 *
 * ```js
 * var Enquirer = require('enquirer');
 * var enquirer = new Enquirer();
 *
 * enquirer.question('first', 'First name?');
 * enquirer.prompt('first')
 *   .then(function(answers) {
 *     console.log(answers)
 *   });
 * ```
 * @emits `prompt` with the `default` value, `key`, `question` object, and `answers` object
 * @emits `answer` with the `answer` value, `key`, `question` object, and `answers` object
 * @param {String} `name`
 * @api public
 */

Enquirer.prototype.prompt = function(name) {
  if (Array.isArray(name)) {
    return this.ask.apply(this, arguments);
  }

  this.lazyInit();
  this.queue = this.queue || [name];
  var answers = this.answers;
  var self = this;

  try {
    var question = this.question(name).clone();
    var PromptType = this.prompts[question.type];
    name = question.name;

    if (typeof PromptType !== 'function') {
      throw new Error(`prompt type "${question.type}" is not registered`);
    }

    var prompt = new PromptType(question, answers, this.ui);
    if (this.session) prompt.session = true;
    this.emit('prompt', question, answers);

  } catch (err) {
    self.emit('error', err);
    this.close();
    throw err;
  }

  return prompt.run(answers)
    .then(function(answer) {
      if (answer) {
        question.answer = answer;
        set(answers, name, answer);
      }
      self.emit('answer', question, answers);
      return answers;
    });
};

/**
 * Create a new `Separator` to use in a choices array.
 * @api public
 */

Enquirer.prototype.separator = function(options) {
  return new Separator(options);
};

/**
 * Visit `method` over the properties in the given object, or map
 * visit over the object-elements in an array.
 *
 * @param {String} `method` The name of the `base` method to call.
 * @param {Object|Array} `val` The object or array to iterate over.
 * @return {Object} Returns the instance for chaining.
 */

Enquirer.prototype.visit = function(method, val) {
  visit(this, method, val);
  return this;
};

/**
 * Create a new `Separator` to use in a choices array.
 * @api public
 */

Enquirer.Separator = Separator;

/**
 * Decorate `Emitter` methods onto the Enquirer prototype
 */

Emitter(Enquirer.prototype);

/**
 * Expose `Enquirer`
 */

module.exports = Enquirer;
