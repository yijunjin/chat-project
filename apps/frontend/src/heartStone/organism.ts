import type { MonsterType } from "../Enum";

// 怪物实例
export default class Monster {
  public name: string;
  public health: number;
  public attack: number;
  public type: string;

  constructor(name: string, health: number, attack: number, type: MonsterType) {
    this.name = name;
    this.health = health;
    this.attack = attack;
    this.type = type;
  }
}
