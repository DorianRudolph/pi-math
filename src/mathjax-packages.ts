// MathJax 4 no longer supplies AllPackages. Register our supported TeX packages
// explicitly: no runtime autoload/require, HTML injection, or error suppression.
import "@mathjax/src/cjs/input/tex/base/BaseConfiguration.js";
import "@mathjax/src/cjs/input/tex/action/ActionConfiguration.js";
import "@mathjax/src/cjs/input/tex/ams/AmsConfiguration.js";
import "@mathjax/src/cjs/input/tex/amscd/AmsCdConfiguration.js";
import "@mathjax/src/cjs/input/tex/bbox/BboxConfiguration.js";
import "@mathjax/src/cjs/input/tex/boldsymbol/BoldsymbolConfiguration.js";
import "@mathjax/src/cjs/input/tex/braket/BraketConfiguration.js";
import "@mathjax/src/cjs/input/tex/bussproofs/BussproofsConfiguration.js";
import "@mathjax/src/cjs/input/tex/cancel/CancelConfiguration.js";
import "@mathjax/src/cjs/input/tex/cases/CasesConfiguration.js";
import "@mathjax/src/cjs/input/tex/centernot/CenternotConfiguration.js";
import "@mathjax/src/cjs/input/tex/color/ColorConfiguration.js";
import "@mathjax/src/cjs/input/tex/colortbl/ColortblConfiguration.js";
import "@mathjax/src/cjs/input/tex/configmacros/ConfigMacrosConfiguration.js";
import "@mathjax/src/cjs/input/tex/empheq/EmpheqConfiguration.js";
import "@mathjax/src/cjs/input/tex/enclose/EncloseConfiguration.js";
import "@mathjax/src/cjs/input/tex/extpfeil/ExtpfeilConfiguration.js";
import "@mathjax/src/cjs/input/tex/gensymb/GensymbConfiguration.js";
import "@mathjax/src/cjs/input/tex/mathtools/MathtoolsConfiguration.js";
import "@mathjax/src/cjs/input/tex/mhchem/MhchemConfiguration.js";
import "@mathjax/src/cjs/input/tex/newcommand/NewcommandConfiguration.js";
import "@mathjax/src/cjs/input/tex/noundefined/NoUndefinedConfiguration.js";
import "@mathjax/src/cjs/input/tex/physics/PhysicsConfiguration.js";
import "@mathjax/src/cjs/input/tex/tagformat/TagFormatConfiguration.js";
import "@mathjax/src/cjs/input/tex/textcomp/TextcompConfiguration.js";
import "@mathjax/src/cjs/input/tex/textmacros/TextMacrosConfiguration.js";
import "@mathjax/src/cjs/input/tex/unicode/UnicodeConfiguration.js";
import "@mathjax/src/cjs/input/tex/upgreek/UpgreekConfiguration.js";
import "@mathjax/src/cjs/input/tex/verb/VerbConfiguration.js";

export const TEX_PACKAGES = [
  "base", "action", "ams", "amscd", "bbox", "boldsymbol", "braket", "bussproofs",
  "cancel", "cases", "centernot", "color", "colortbl", "configmacros", "empheq",
  "enclose", "extpfeil", "gensymb", "mathtools", "mhchem", "newcommand", "physics",
  "tagformat", "textcomp", "textmacros", "unicode", "upgreek", "verb",
];
