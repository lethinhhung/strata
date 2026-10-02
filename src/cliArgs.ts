interface Args {
  positional: string[];
  options: {
    help?: boolean;
    version?: boolean;
    force?: boolean;
    repo?: string;
    config?: string;
    [key: string]: string | boolean | undefined;
  };
}

export function args(argv: string[]): Args {
  const positional: string[] = [];
  const options: Args['options'] = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--help' || token === '-h') options.help = true;
    else if (token === '--version') options.version = true;
    else if (token === '--force') options.force = true;
    else if (token === '--review-plan') options.reviewPlan = true;
    else if (token === '--repo' || token === '--config' || token === '--prompt' || token === '--branch') {
      if (!argv[i + 1]) throw new Error(`${token} requires a value`);
      options[token.slice(2)] = argv[++i];
    } else if (token.startsWith('-')) throw new Error(`Unknown option ${token}`);
    else positional.push(token);
  }
  return { positional, options };
}
