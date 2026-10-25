# frozen_string_literal: true

require_relative "lib/moneytrees/version"

Gem::Specification.new do |spec|
  spec.name = "moneytrees"
  spec.version = MoneyTrees::VERSION
  spec.authors = ["MoneyTrees"]
  spec.email = ["support@moneytrees.ai"]

  spec.summary = "Ruby client for MoneyTrees trading signals"
  spec.description = "Market movers, ticker lookup, the signal feed, the sandbox, docs search and the docs MCP " \
                     "server at moneytrees.ai. Standard library only."
  spec.homepage = "https://moneytrees.ai"
  spec.license = "MIT"
  spec.required_ruby_version = ">= 2.6"

  spec.metadata = {
    "homepage_uri" => spec.homepage,
    "documentation_uri" => "https://moneytrees.ai/developers",
    "source_code_uri" => "https://github.com/CesarBenavides777/moneytrees-agent-tools/tree/main/ruby",
    "bug_tracker_uri" => "https://github.com/CesarBenavides777/moneytrees-agent-tools/issues",
    "rubygems_mfa_required" => "true"
  }

  spec.files = Dir["lib/**/*.rb"] + %w[README.md LICENSE]
  spec.require_paths = ["lib"]
end
