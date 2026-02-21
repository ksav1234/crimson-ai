const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const User = require('./User');

const CustomApi = sequelize.define('CustomApi', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  userId: {
    type: DataTypes.STRING,
    allowNull: false,
    references: {
      model: User,
      key: 'id'
    }
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  url: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  key: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  model: {
    type: DataTypes.STRING,
    allowNull: false
  },
  format: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'openai'
  },
  headers: {
    type: DataTypes.TEXT,
    allowNull: true,
    defaultValue: '{}',
    get() {
      const rawValue = this.getDataValue('headers');
      return rawValue ? JSON.parse(rawValue) : {};
    },
    set(value) {
      this.setDataValue('headers', JSON.stringify(value || {}));
    }
  },
  customBody: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  responsePath: {
    type: DataTypes.STRING,
    allowNull: true
  },
  index: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  }
}, {
  tableName: 'custom_apis',
  timestamps: true
});

// Define relationships
User.hasMany(CustomApi, { foreignKey: 'userId', as: 'customApis' });
CustomApi.belongsTo(User, { foreignKey: 'userId', as: 'user' });

module.exports = CustomApi;