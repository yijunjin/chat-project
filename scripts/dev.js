// 这个文件会帮我们打包 packages下的模块，最终打包出js文件

// node dev.js （要打包的名字 -f 打包的格式） === argv.slice(2)
import minimist from "minimist";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module"; // 这个模块是用来创建一个require函数的
import esbuild from "esbuild"; // 引入esbuild模块

// node中的命令函数参数通过process.argv获取
process.argv.slice(2); // 取出命令行参数
const args = minimist(process.argv.slice(2)); // 解析命令行参数
const __filename = fileURLToPath(import.meta.url); // 当前文件的路径
const __dirname = dirname(__filename); // 当前文件所在目录的路径
// console.log(__filename, __dirname);
const require = createRequire(import.meta.url); // 创建一个require函数
const target = args._[0] || "reactivity"; // 打包哪个项目
const format = args.f || "iife"; // 打包的格式
// console.log(target, format); // index index cjs

const entry = resolve(__dirname, `../packages/${target}/src/index.ts`); // 入口文件
const pkg = require(`../packages/${target}/package.json`); // 获取package.json文件

esbuild
  .context({
    entryPoints: [entry], // 入口文件
    bundle: true, // 打包
    outfile: resolve(
      __dirname,
      `../packages/${target}/dist/${target}.${format}.js`
    ), // 输出文件
    format, // 输出格式
    platform: "browser", // 平台
    sourcemap: true, // 是否生成sourcemap
    globalName: pkg.buildOptions?.name || "Vue", // 全局变量名
  })
  .then((ctx) => {
    ctx.watch(); // 监听文件变化
    console.log("watching..."); // 打包完成
  }); // 打包完成
